"""Server-owned model credentials and idempotent, token-metered star billing."""
import base64
import hashlib
import json
import os
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_CEILING, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import Field, model_validator
from sqlalchemy import Column, String, Text, JSON, BigInteger, select, delete
from sqlalchemy.orm import Session
from . import main as m
from .admin import authorized, Audit
from .schema import Strict
from .stars import Action, Wallet, Transaction, lock_users, wallet, ident, now

router = APIRouter()
slots = threading.BoundedSemaphore(3)
TZ = ZoneInfo('Asia/Shanghai')
STALE_MS = 180000

def holiday_defaults():
    days = []
    for start, end in [('2026-01-01','2026-01-03'),('2026-02-15','2026-02-23'),('2026-04-04','2026-04-06'),('2026-05-01','2026-05-05'),('2026-06-19','2026-06-21'),('2026-09-25','2026-09-27'),('2026-10-01','2026-10-07')]:
        date = datetime.fromisoformat(start)
        while date.isoformat()[:10] <= end:
            days.append(date.date().isoformat()); date += timedelta(days=1)
    return days

class Rules(Strict):
    enabled: bool = False
    model: str = Field(default='deepseek-flash',pattern=r'^deepseek-[a-zA-Z0-9._-]{1,60}$')
    multiplier: str = '5'
    coinsPerYuan: int = Field(default=100,ge=1,le=100000)
    peakHit: str = '0.04'
    peakMiss: str = '2'
    peakOutput: str = '8'
    offHit: str = '0.02'
    offMiss: str = '1'
    offOutput: str = '4'
    period: str = Field(default='auto',pattern=r'^(auto|peak|off)$')
    calendarYear: int = Field(default=2026,ge=2026,le=2100)
    holidays: list[str] = Field(default_factory=holiday_defaults,max_length=150)
    maxTokens: int = Field(default=8192,ge=256,le=8192)
    maxCharge: int = Field(default=100,ge=1,le=1000)

    @model_validator(mode='after')
    def check(self):
        for field in ['multiplier','peakHit','peakMiss','peakOutput','offHit','offMiss','offOutput']:
            try: value=Decimal(getattr(self,field))
            except InvalidOperation: raise ValueError('费率无效')
            if not value.is_finite() or value <= 0 or value > 10000: raise ValueError('费率须大于0且不超过10000')
        for day in self.holidays:
            try: datetime.strptime(day,'%Y-%m-%d')
            except ValueError: raise ValueError('假期请使用YYYY-MM-DD')
        return self

class Settings(Rules):
    apiKey: str = Field(default='',max_length=500)
    deleteKey: bool = False

class Config(m.Base):
    __tablename__='assistant_config'
    id=Column(String(20),primary_key=True)
    rules=Column(JSON,nullable=False)
    secret=Column(Text,nullable=False,default='')

class Call(m.Base):
    __tablename__='assistant_calls'
    id=Column(String(64),primary_key=True)
    user_id=Column(String(12),nullable=False,index=True)
    fingerprint=Column(String(64),nullable=False)
    parent_id=Column(String(64),nullable=True,index=True,unique=True)
    state=Column(String(20),nullable=False)
    reserved=Column(BigInteger,nullable=False,default=0)
    charged=Column(BigInteger,nullable=False,default=0)
    created_at=Column(BigInteger,nullable=False,index=True)
    result=Column(JSON,nullable=True)
    error=Column(String(150),nullable=False,default='')
    usage=Column(JSON,nullable=True)
    pricing=Column(JSON,nullable=True)

class Chat(Action):
    messages: list[dict] = Field(min_length=1,max_length=14)
    continuationOf: str = Field(default='',max_length=64,pattern=r'^[A-Za-z0-9_-]*$')

def cipher():
    try: return Fernet(Path(os.environ.get('AI_KEY_FILE','/run/secrets/starorbit-ai-key')).read_bytes().strip())
    except Exception: raise HTTPException(503,'模型密钥存储尚未就绪，请联系管理员')

def config(session):
    row=session.get(Config,'default')
    return row, Rules.model_validate(row.rules) if row else Rules()

def period_at(rules, timestamp):
    if rules.period!='auto': return rules.period
    date=datetime.fromtimestamp(timestamp/1000,TZ)
    if date.year!=rules.calendarYear: raise HTTPException(503,'计费日历需更新，请联系管理员')
    return 'peak' if date.weekday()<5 and date.date().isoformat() not in rules.holidays and (9<=date.hour<12 or 14<=date.hour<18) else 'off'

def price(usage,rules,period):
    def count(name,default=None):
        value=usage.get(name,default)
        if type(value) is not int or not 0<=value<=2000000: raise ValueError('缺少有效用量')
        return value
    prompt=count('prompt_tokens'); output=count('completion_tokens')
    hit=count('prompt_cache_hit_tokens',(usage.get('prompt_tokens_details') or {}).get('cached_tokens',0))
    if hit>prompt: raise ValueError('用量无效')
    if 'prompt_cache_miss_tokens' in usage and count('prompt_cache_miss_tokens')!=prompt-hit: raise ValueError('缓存用量不一致')
    raw=(Decimal(hit)*Decimal(getattr(rules,period+'Hit'))+Decimal(prompt-hit)*Decimal(getattr(rules,period+'Miss'))+Decimal(output)*Decimal(getattr(rules,period+'Output')))/Decimal(1000000)
    cost=int((raw*Decimal(rules.multiplier)*rules.coinsPerYuan).to_integral_value(rounding=ROUND_CEILING))
    return max(1,cost), {'promptTokens':prompt,'cachedTokens':hit,'outputTokens':output,'providerYuan':str(raw),'rawCoins':str(raw*Decimal(rules.multiplier)*rules.coinsPerYuan)}

def recover_user(session,user_id,force=False):
    query=select(Call).where(Call.user_id==user_id,Call.state=='pending')
    if not force:query=query.where(Call.created_at<now()-STALE_MS)
    rows=session.scalars(query).all()
    for row in rows:
        wallet(session,user_id).balance+=row.reserved; row.reserved=0;row.state='failed';row.error='上次请求中断，预留星币已退回，请重新发送'
    return bool(rows)

def recover_all():
    with Session(m.engine) as session:
        ids=session.scalars(select(Call.user_id).where(Call.state=='pending').distinct()).all()
        for user_id in ids:
            lock_users(session,[user_id]);recover_user(session,user_id,force=True)
        session.commit()

def validate_messages(messages):
    images=0; size=0
    for message in messages:
        if set(message)-{'role','content'} or message.get('role') not in ('system','user','assistant'): raise HTTPException(422,'对话格式无效')
        content=message.get('content')
        if isinstance(content,str):size+=len(content.encode())
        elif isinstance(content,list) and message['role']=='user':
            for part in content:
                if not isinstance(part,dict):raise HTTPException(422,'图片格式无效')
                if part.get('type')=='text' and isinstance(part.get('text'),str):size+=len(part['text'].encode())
                elif part.get('type')=='image_url':
                    url=(part.get('image_url') or {}).get('url','')
                    if not isinstance(url,str) or not url.startswith(('data:image/jpeg;base64,','data:image/png;base64,','data:image/webp;base64,')):raise HTTPException(422,'仅支持上传图片')
                    if len(url)>260000:raise HTTPException(422,'单张图片过大，请缩小后重试')
                    try:base64.b64decode(url.split(',',1)[1],validate=True)
                    except Exception:raise HTTPException(422,'图片格式无效')
                    images+=1
                else:raise HTTPException(422,'对话内容无效')
        else:raise HTTPException(422,'对话内容无效')
    if images>10 or size>100000:raise HTTPException(422,'最多十张图片，或请缩短对话内容')
    if messages[-1].get('role')!='user':raise HTTPException(422,'请发送用户消息')

def provider_call(key,rules,messages):
    payload={'model':rules.model,'messages':messages,'stream':False,'max_tokens':rules.maxTokens,'thinking':{'type':'disabled'},'response_format':{'type':'json_object'}}
    request=urllib.request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
    # Never follow an unexpected redirect with the model credential.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    with urllib.request.build_opener(NoRedirect).open(request,timeout=75) as response:
        body=response.read(1024*1024+1)
        if len(body)>1024*1024:raise ValueError('回复过大')
        return json.loads(body)

@router.get('/api/v1/ai/status')
def status(token=Depends(m.authenticated),session:Session=Depends(m.db)):
    lock_users(session,[token.user_id]);recover_user(session,token.user_id)
    row,rules=config(session);balance=wallet(session,token.user_id).balance;session.commit()
    return {'enabled':bool(row and row.secret and rules.enabled),'balance':balance,'multiplier':rules.multiplier,'coinsPerYuan':rules.coinsPerYuan,'rounding':'ceil','maxCharge':rules.maxCharge}

@router.get('/api/v1/ai/requests/{request_id}')
def result(request_id:str,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    lock_users(session,[token.user_id]);recover_user(session,token.user_id);session.commit()
    row=session.get(Call,hashlib.sha256((token.user_id+':'+request_id).encode()).hexdigest())
    if not row:raise HTTPException(404,'请求不存在')
    if row.state=='done':return row.result
    if row.state=='pending':raise HTTPException(409,'正在生成回复，请稍后重试查询')
    raise HTTPException(502,row.error or '本次请求未完成，未扣费')

@router.post('/api/v1/ai/chat')
def chat(data:Chat,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    validate_messages(data.messages)
    if not slots.acquire(blocking=False):raise HTTPException(429,'星小助有点忙，请稍后重试')
    call_id=hashlib.sha256((token.user_id+':'+data.requestId).encode()).hexdigest()
    fingerprint=hashlib.sha256(json.dumps(data.model_dump(exclude={'requestId'}),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    reserved=False
    try:
        lock_users(session,[token.user_id]);recover_user(session,token.user_id)
        old=session.get(Call,call_id)
        if old:
            if old.fingerprint!=fingerprint:raise HTTPException(409,'请求编号已使用')
            if old.state=='done':session.commit();return old.result
            raise HTTPException(409,'该请求正在处理，请查询原回复' if old.state=='pending' else old.error)
        m.throttle(('ai-user',token.user_id),5,60);m.throttle(('ai-day',token.user_id),100,86400)
        row,rules=config(session)
        if not row or not row.secret or not rules.enabled:raise HTTPException(503,'星小助暂未开放，请稍后再来')
        try:key=cipher().decrypt(row.secret.encode()).decode()
        except HTTPException:raise
        except Exception:raise HTTPException(503,'模型密钥不可用，请联系管理员')
        period=period_at(rules,now())
        if session.scalar(select(Call.id).where(Call.user_id==token.user_id,Call.state=='pending').limit(1)):raise HTTPException(409,'请等待上一条回复完成')
        parent=None
        if data.continuationOf:
            parent_key=hashlib.sha256((token.user_id+':'+data.continuationOf).encode()).hexdigest()
            parent=session.get(Call,parent_key)
            if not parent or parent.state!='done' or parent.parent_id or parent.created_at<now()-600000:raise HTTPException(409,'校正请求已失效，请重新发送')
            if session.scalar(select(Call.id).where(Call.parent_id==parent.id).limit(1)):raise HTTPException(409,'这条回复已校正，请查询原回复')
            if len(data.messages)<2 or data.messages[-2]!={'role':'assistant','content':parent.result['choices'][0]['message']['content']}:raise HTTPException(422,'校正上下文不匹配')
        balance=wallet(session,token.user_id).balance
        if balance<1 and not parent:raise HTTPException(402,'星币不足，请先兑换星币')
        hold=min(balance,rules.maxCharge)
        wallet(session,token.user_id).balance-=hold
        parent_id=parent.id if parent else None
        parent_raw=Decimal(parent.usage['rawCoins']) if parent else Decimal(0)
        parent_charged=parent.charged if parent else 0
        session.add(Call(id=call_id,user_id=token.user_id,fingerprint=fingerprint,parent_id=parent_id,state='pending',reserved=hold,created_at=now(),pricing={**rules.model_dump(),'periodUsed':period}))
        session.commit();reserved=True
        try:
            response=provider_call(key,rules,data.messages)
            choice=response['choices'][0]
            if choice.get('finish_reason') not in ('stop',):raise ValueError('回复未完成')
            proposal=json.loads(choice['message']['content'])
            if not isinstance(proposal,dict) or not isinstance(proposal.get('message'),str) or not isinstance(proposal.get('operations',[]),list):raise ValueError('回复格式无效')
            charge,usage=price(response.get('usage',{}),rules,period)
            if parent_id:
                total=int((parent_raw+Decimal(usage['rawCoins'])).to_integral_value(rounding=ROUND_CEILING))
                charge=max(0,total-parent_charged)
            if charge+parent_charged>rules.maxCharge:raise ValueError('超过单次费用上限')
            if charge>hold:raise ValueError('费用超出本次可用星币，请缩小任务后重试')
        except Exception:
            lock_users(session,[token.user_id]);call=session.get(Call,call_id,populate_existing=True)
            if call.state=='pending':
                wallet(session,token.user_id).balance+=call.reserved;call.reserved=0;call.state='failed';call.error='本次回复未完成，未扣星币；请缩小任务或稍后重试';session.commit()
            raise HTTPException(502,'本次回复未完成，未扣星币；请缩小任务或稍后重试')
        lock_users(session,[token.user_id]);call=session.get(Call,call_id,populate_existing=True)
        if call.state!='pending':raise HTTPException(409,'请求已结束，未再次扣费')
        w=wallet(session,token.user_id);w.balance+=call.reserved-charge
        answer={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':choice['message']['content']}}],'billing':{'coins':charge,'balance':w.balance,'requestId':data.requestId,**usage,'period':period}}
        call.state='done';call.charged=charge;call.reserved=0;call.result=answer;call.usage=usage
        if charge:session.add(Transaction(id=ident(),user_id=token.user_id,operation_id=call_id,amount=-charge,balance=w.balance,kind='ai_chat',counterpart='星小助',note='星小助对话校正' if parent_id else '星小助对话',created_at=now()))
        session.commit();reserved=False
        return answer
    except HTTPException:raise
    except Exception:
        session.rollback()
        if reserved:
            lock_users(session,[token.user_id]);call=session.get(Call,call_id,populate_existing=True)
            if call and call.state=='pending':wallet(session,token.user_id).balance+=call.reserved;call.reserved=0;call.state='failed';call.error='请求异常，未扣星币';session.commit()
        raise HTTPException(503,'星小助暂时不可用，请稍后重试')
    finally:slots.release()

@router.get('/admin/assistant/',include_in_schema=False)
def admin_page():
    return FileResponse(Path(__file__).parent/'admin-web'/'assistant.html',headers={'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"})

@router.get('/admin/assistant.js',include_in_schema=False)
def admin_js():return FileResponse(Path(__file__).parent/'admin-web'/'assistant.js',media_type='application/javascript')

@router.get('/admin/api/assistant')
def admin_get(auth=Depends(authorized),session:Session=Depends(m.db)):
    row,rules=config(session)
    return {**rules.model_dump(),'hasKey':bool(row and row.secret),'keyStoreReady':Path(os.environ.get('AI_KEY_FILE','/run/secrets/starorbit-ai-key')).is_file()}

@router.post('/admin/api/assistant')
def admin_save(data:Settings,auth=Depends(authorized),session:Session=Depends(m.db)):
    row=session.scalar(select(Config).where(Config.id=='default').with_for_update())
    if row is None:row=Config(id='default',secret='');session.add(row)
    if data.deleteKey:row.secret=''
    if data.apiKey.strip():
        key=data.apiKey.strip()
        if not key.startswith('sk-') or any(c.isspace() for c in key):raise HTTPException(422,'API Key格式无效')
        row.secret=cipher().encrypt(key.encode()).decode()
    if data.enabled and not row.secret:raise HTTPException(422,'请先填写模型API Key')
    row.rules=Rules.model_validate(data.model_dump(exclude={'apiKey','deleteKey'})).model_dump()
    session.add(Audit(id=ident(),admin=auth.username,user_id='',action='assistant_config',created_at=int(time.time())))
    session.commit();return {'ok':True,'hasKey':bool(row.secret)}

@router.get('/admin/api/assistant/usage')
def admin_usage(offset:int=Query(0,ge=0,le=1000000),auth=Depends(authorized),session:Session=Depends(m.db)):
    rows=session.scalars(select(Call).order_by(Call.created_at.desc()).offset(offset).limit(51)).all()
    return {'calls':[{'id':r.id,'userId':r.user_id,'state':r.state,'coins':r.charged,'createdAt':r.created_at,'usage':r.usage,'pricing':r.pricing,'error':r.error} for r in rows[:50]],'hasMore':len(rows)>50}
