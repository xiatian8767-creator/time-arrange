"""Server-authoritative star wallet. All balance changes and delivery creation are atomic."""
import base64
import hashlib
import html
import io
import json
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import Field
from PIL import Image
from sqlalchemy import Column, String, Text, BigInteger, Boolean, JSON, ForeignKey, CheckConstraint, select, func
from sqlalchemy.orm import Session
from . import main as m
from .schema import Strict
from .admin import authorized, Audit
from .campaigns import Campaign, CampaignImage
from .feedback import normalized_image

router = APIRouter()
PUBLIC = 'https://8.154.43.154:8443'
def now(): return int(time.time()*1000)
def ident(): return secrets.token_hex(16)

class StarProfile(m.Base):
    __tablename__='star_profiles'
    user_id=Column(String(12),ForeignKey('users.id'),primary_key=True)
    avatar=Column(Text,nullable=True)
    app_version=Column(String(40),nullable=False,default='')
    last_seen=Column(BigInteger,nullable=False,default=0)

class Wallet(m.Base):
    __tablename__='star_wallets'
    user_id=Column(String(12),ForeignKey('users.id'),primary_key=True)
    balance=Column(BigInteger,nullable=False,default=0)
    __table_args__=(CheckConstraint('balance >= 0 AND balance <= 1000000000'),)

class Operation(m.Base):
    __tablename__='star_operations'
    id=Column(String(64),primary_key=True)
    fingerprint=Column(String(64),nullable=False)
    result=Column(JSON,nullable=False)

class Transaction(m.Base):
    __tablename__='star_transactions'
    id=Column(String(32),primary_key=True)
    user_id=Column(String(12),ForeignKey('users.id'),nullable=False,index=True)
    operation_id=Column(String(64),nullable=False,index=True)
    amount=Column(BigInteger,nullable=False)
    balance=Column(BigInteger,nullable=False)
    kind=Column(String(20),nullable=False)
    counterpart=Column(String(40),nullable=False,default='')
    note=Column(String(200),nullable=False,default='')
    created_at=Column(BigInteger,nullable=False,index=True)

class CoinCode(m.Base):
    __tablename__='star_codes'
    id=Column(String(32),primary_key=True)
    code=Column(String(40),unique=True,nullable=False)
    amount=Column(BigInteger,nullable=False)
    reusable=Column(Boolean,nullable=False)
    enabled=Column(Boolean,nullable=False,default=True)
    created_at=Column(BigInteger,nullable=False)

class Redemption(m.Base):
    __tablename__='star_redemptions'
    code_id=Column(String(32),ForeignKey('star_codes.id'),primary_key=True)
    user_id=Column(String(12),ForeignKey('users.id'),primary_key=True)
    created_at=Column(BigInteger,nullable=False)

class StarMessage(m.Base):
    __tablename__='star_messages'
    id=Column(String(32),primary_key=True)
    sender=Column(String(40),nullable=False,index=True)
    recipient=Column(String(12),ForeignKey('users.id'),nullable=False)
    image_id=Column(String(32),ForeignKey('campaign_images.id'),nullable=True)
    text=Column(String(500),nullable=False)
    background=Column(String(7),nullable=False)
    color=Column(String(7),nullable=False)
    created_at=Column(BigInteger,nullable=False)

class ProfileInput(Strict):
    avatar: str | None = Field(default=None,max_length=250000)
    version: str = Field(default='',max_length=40)

class GiftPresentation(m.Base):
    __tablename__='star_gift_presentations'
    message_id=Column(String(32),ForeignKey('star_messages.id'),primary_key=True)
    amount=Column(BigInteger,nullable=False,default=0)

class Action(Strict):
    requestId: str = Field(pattern=r'^[A-Za-z0-9_-]{16,64}$')

class Message(Strict):
    text: str = Field(min_length=1,max_length=500)
    image: str = Field(default='',max_length=250000)
    templateId: str = Field(default='',max_length=32)
    background: str = Field(default='#fff7e9',pattern=r'^#[a-fA-F0-9]{6}$')
    color: str = Field(default='#1c2945',pattern=r'^#[a-fA-F0-9]{6}$')
    startsAt: int = Field(default=0,ge=0,le=4102444800000)

class Send(Action):
    partnerId: str = Field(pattern=r'^[a-f0-9]{12}$')
    message: Message

class Gift(Action):
    partnerId: str = Field(pattern=r'^[a-f0-9]{12}$')
    amount: int = Field(strict=True,ge=1,le=1000000)
    note: str = Field(default='',max_length=200)
    image: str = Field(default='',max_length=250000)

class Redeem(Action):
    code: str = Field(min_length=1,max_length=40)

class Grant(Action):
    amount: int = Field(strict=True,ge=1,le=1000000)
    note: str = Field(default='',max_length=200)
    message: Message | None = None

class Codes(Action):
    count: int = Field(strict=True,ge=1,le=200)
    amount: int = Field(strict=True,ge=1,le=1000000)
    reusable: bool = False

def lock_users(session, ids):
    rows=session.scalars(select(m.User).where(m.User.id.in_(sorted(set(ids)))).order_by(m.User.id).with_for_update()).all()
    if len(rows)!=len(set(ids)): raise HTTPException(404,'用户不存在')
    return {u.id:u for u in rows}

def wallet(session, user_id):
    row=session.get(Wallet,user_id)
    if row is None:
        row=Wallet(user_id=user_id,balance=0);session.add(row);session.flush()
    return row

def operation(session, actor, kind, data):
    key=hashlib.sha256((actor+':'+data.requestId).encode()).hexdigest()
    fingerprint=hashlib.sha256((kind+json.dumps(data.model_dump(),sort_keys=True,ensure_ascii=False)).encode()).hexdigest()
    old=session.get(Operation,key)
    if old and old.fingerprint!=fingerprint: raise HTTPException(409,'请求已使用，请重新打开操作窗口')
    return key,fingerprint,old.result if old else None

def finish(session, key, fingerprint, result):
    session.add(Operation(id=key,fingerprint=fingerprint,result=result));session.commit();return result

def change(session,user_id,amount,key,kind,counterpart='',note=''):
    row=wallet(session,user_id)
    if row.balance+amount<0: raise HTTPException(409,'星币不足')
    if row.balance+amount>1000000000: raise HTTPException(409,'余额已达上限')
    row.balance+=amount
    session.add(Transaction(id=ident(),user_id=user_id,operation_id=key,amount=amount,balance=row.balance,kind=kind,counterpart=counterpart,note=note,created_at=now()))
    return row.balance

def mate(session,token,partner_id):
    users=lock_users(session,[token.user_id,partner_id])
    if token.user_id==partner_id or users[token.user_id].partner_id!=partner_id or users[partner_id].partner_id!=token.user_id:
        raise HTTPException(409,'搭子关系已变化，请刷新后重试')
    return users

def create_message(session,sender,recipient,data,title,amount=0):
    if not data.text.strip(): raise HTTPException(422,'请填写内容')
    image_id=None
    if data.templateId:
        template=session.get(StarMessage,data.templateId)
        if not template or template.sender!=sender: raise HTTPException(404,'模板不存在')
        image_id=template.image_id
    if data.image:
        image_id=ident();session.add(CampaignImage(id=image_id,data=normalized_image(data.image),created_at=now()));session.flush()
    message=StarMessage(id=ident(),sender=sender,recipient=recipient,image_id=image_id,text=data.text.strip(),background=data.background,color=data.color,created_at=now())
    session.add(message)
    session.flush()
    session.add(GiftPresentation(message_id=message.id,amount=amount))
    campaign=Campaign(id=ident(),title=title[:80],url=PUBLIC+'/updates/messages/'+message.id+'/',width=68,height=66,audience='custom',user_ids=[recipient],starts_at=data.startsAt or now(),frequency='once',enabled=True,revision=1,created_at=now())
    session.add(campaign)
    return campaign.id

def person(session,user):
    if not user:return None
    p=session.get(StarProfile,user.id)
    return {'userId':user.id,'nickname':user.nickname,'avatar':('data:image/jpeg;base64,'+p.avatar) if p and p.avatar else None}

def avatar_image(value):
    raw=normalized_image(value)
    with Image.open(io.BytesIO(base64.b64decode(raw))) as image:
        image.thumbnail((256,256));out=io.BytesIO();image.save(out,'JPEG',quality=85,optimize=True)
    return base64.b64encode(out.getvalue()).decode('ascii')

def ledger(session,user_id,offset=0):
    rows=session.scalars(select(Transaction).where(Transaction.user_id==user_id).order_by(Transaction.created_at.desc(),Transaction.id).offset(offset).limit(51)).all()
    return {'transactions':[{'id':r.id,'amount':r.amount,'balance':r.balance,'kind':r.kind,'counterpart':r.counterpart,'note':r.note,'createdAt':r.created_at} for r in rows[:50]],'hasMore':len(rows)>50}

@router.get('/api/v1/stars')
def overview(token=Depends(m.authenticated),session:Session=Depends(m.db)):
    user=session.get(m.User,token.user_id);w=session.get(Wallet,user.id)
    return {'user':person(session,user),'partner':person(session,session.get(m.User,user.partner_id)) if user.partner_id else None,'balance':w.balance if w else 0}

@router.post('/api/v1/stars/profile')
def profile(data:ProfileInput,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    lock_users(session,[token.user_id]);p=session.get(StarProfile,token.user_id)
    if p is None:p=StarProfile(user_id=token.user_id);session.add(p)
    if 'avatar' in data.model_fields_set:p.avatar=avatar_image(data.avatar) if data.avatar else None
    if data.version:p.app_version=data.version
    p.last_seen=now();session.commit();return {'ok':True}

@router.get('/api/v1/stars/transactions')
def history(offset:int=Query(0,ge=0,le=1000000),token=Depends(m.authenticated),session:Session=Depends(m.db)):
    return ledger(session,token.user_id,offset)

@router.post('/api/v1/stars/gift')
def gift(data:Gift,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    users=mate(session,token,data.partnerId);key,fp,old=operation(session,token.user_id,'gift',data)
    if old is not None:return old
    balance=change(session,token.user_id,-data.amount,key,'gift_out',data.partnerId,data.note)
    change(session,data.partnerId,data.amount,key,'gift_in',token.user_id,data.note)
    create_message(session,token.user_id,data.partnerId,Message(text=data.note.strip() or '送你一点小心意 ✨',image=data.image),'搭子的星币礼物',amount=data.amount)
    return finish(session,key,fp,{'balance':balance,'ok':True})

@router.post('/api/v1/stars/send')
def send(data:Send,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    users=mate(session,token,data.partnerId);key,fp,old=operation(session,token.user_id,'send',data)
    if old is not None:return old
    balance=change(session,token.user_id,-1,key,'popup',data.partnerId,'发送搭子弹窗')
    campaign=create_message(session,token.user_id,data.partnerId,data.message,users[token.user_id].nickname+' 的留言')
    return finish(session,key,fp,{'balance':balance,'campaignId':campaign})

@router.get('/api/v1/stars/templates')
def templates(token=Depends(m.authenticated),session:Session=Depends(m.db)):
    rows=session.scalars(select(StarMessage).where(StarMessage.sender==token.user_id).order_by(StarMessage.created_at.desc()).limit(20)).all()
    return {'templates':[{'id':r.id,'text':r.text,'background':r.background,'color':r.color,'hasImage':bool(r.image_id)} for r in rows]}

@router.post('/api/v1/stars/redeem')
def redeem(data:Redeem,token=Depends(m.authenticated),session:Session=Depends(m.db)):
    m.throttle(('star-redeem',token.user_id),20,300)
    lock_users(session,[token.user_id]);key,fp,old=operation(session,token.user_id,'redeem',data)
    if old is not None:return old
    row=session.scalar(select(CoinCode).where(CoinCode.code==data.code.strip().upper()).with_for_update())
    if not row or not row.enabled:raise HTTPException(422,'兑换码不存在或已停用')
    if session.get(Redemption,(row.id,token.user_id)):raise HTTPException(409,'你已使用过这个兑换码')
    if not row.reusable and session.scalar(select(Redemption).where(Redemption.code_id==row.id)):raise HTTPException(409,'兑换码已被使用')
    balance=change(session,token.user_id,row.amount,key,'redeem',note='兑换码兑换')
    session.add(Redemption(code_id=row.id,user_id=token.user_id,created_at=now()))
    return finish(session,key,fp,{'balance':balance,'amount':row.amount})

@router.get('/updates/messages/{message_id}/')
def message_page(message_id:str,session:Session=Depends(m.db)):
    row=session.get(StarMessage,message_id)
    if not row:raise HTTPException(404)
    from .gift_view import render_gift
    presentation=session.get(GiftPresentation,row.id)
    sender=person(session,session.get(m.User,row.sender)) if not row.sender.startswith('admin:') else None
    content=render_gift(sender['nickname'] if sender else 'Star Orbit',row.text,'/updates/images/'+row.image_id+'/asset' if row.image_id else '',sender['avatar'] if sender else '',presentation.amount if presentation else 0)
    return HTMLResponse(content,headers={'Content-Security-Policy':"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"})

@router.get('/updates/gift-art/{name}')
def gift_art(name:str):
    if name not in ('star-gift.png','star-letter.png','star-sprites.png'):raise HTTPException(404)
    return FileResponse(Path(__file__).parent/'gift-art'/name,media_type='image/png')

class GiftPreview(Strict):
    amount:int=Field(strict=True,ge=1,le=1000000)
    text:str=Field(default='',max_length=500)
    image:str=Field(default='',max_length=250000)

@router.post('/admin/api/star-preview')
def gift_preview(data:GiftPreview,auth=Depends(authorized)):
    from .gift_view import render_gift
    image='data:image/jpeg;base64,'+normalized_image(data.image) if data.image else ''
    return {'html':render_gift('Star Orbit',data.text or '送你一点小心意 ✨',image,amount=data.amount,preview=True)}

@router.get('/admin/api/users/{user_id}/detail')
def detail(user_id:str,offset:int=Query(0,ge=0,le=1000000),auth=Depends(authorized),session:Session=Depends(m.db)):
    user=session.get(m.User,user_id)
    if not user:raise HTTPException(404,'用户不存在')
    p=session.get(StarProfile,user_id);w=session.get(Wallet,user_id)
    return {'user':{**person(session,user),'username':user.username},'partner':person(session,session.get(m.User,user.partner_id)) if user.partner_id else None,'balance':w.balance if w else 0,'appVersion':p.app_version if p else '', 'lastSeen':p.last_seen if p else 0,'revision':user.revision,'hasBackup':user.document is not None,**ledger(session,user_id,offset)}

@router.get('/admin/api/users/{user_id}/backup')
def backup(user_id:str,auth=Depends(authorized),session:Session=Depends(m.db)):
    user=session.get(m.User,user_id)
    if not user or user.document is None:raise HTTPException(404,'暂无云端备份')
    session.add(Audit(id=ident(),admin=auth.username,user_id=user_id,action='backup_export',created_at=int(time.time())));session.commit()
    return Response(json.dumps(user.document,ensure_ascii=False,indent=2),media_type='application/json',headers={'Content-Disposition':'attachment; filename="StarOrbit-'+user_id+'.json"'})

@router.post('/admin/api/users/{user_id}/stars')
def grant(user_id:str,data:Grant,auth=Depends(authorized),session:Session=Depends(m.db)):
    # Lock admin first: serialize its idempotency keys even across different recipients.
    from .admin import Admin
    session.scalar(select(Admin).where(Admin.username==auth.username).with_for_update())
    lock_users(session,[user_id]);key,fp,old=operation(session,'admin:'+auth.username,'grant:'+user_id,data)
    if old is not None:return old
    balance=change(session,user_id,data.amount,key,'admin_grant',auth.username,data.note)
    if data.message:create_message(session,'admin:'+auth.username,user_id,data.message,'星币到账',amount=data.amount)
    session.add(Audit(id=ident(),admin=auth.username,user_id=user_id,action='star_grant',created_at=int(time.time())))
    return finish(session,key,fp,{'balance':balance,'ok':True})

@router.post('/admin/api/star-codes')
def codes_create(data:Codes,auth=Depends(authorized),session:Session=Depends(m.db)):
    from .admin import Admin
    session.scalar(select(Admin).where(Admin.username==auth.username).with_for_update())
    key,fp,old=operation(session,'admin:'+auth.username,'codes',data)
    if old is not None:return old
    rows=[]
    for _ in range(data.count):
        code='SO-'+secrets.token_hex(12).upper();row=CoinCode(id=ident(),code=code,amount=data.amount,reusable=data.reusable,enabled=True,created_at=now());session.add(row);rows.append(code)
    session.add(Audit(id=ident(),admin=auth.username,user_id='',action='star_codes_create',created_at=int(time.time())))
    return finish(session,key,fp,{'codes':rows})

@router.get('/admin/api/star-codes')
def codes_list(offset:int=Query(0,ge=0,le=1000000),auth=Depends(authorized),session:Session=Depends(m.db)):
    rows=session.scalars(select(CoinCode).order_by(CoinCode.created_at.desc(),CoinCode.id).offset(offset).limit(51)).all()
    return {'codes':[{'id':r.id,'code':r.code,'amount':r.amount,'reusable':r.reusable,'enabled':r.enabled,'used':session.scalar(select(func.count()).select_from(Redemption).where(Redemption.code_id==r.id))} for r in rows[:50]],'hasMore':len(rows)>50}

class CodeState(Strict):
    enabled:bool

@router.post('/admin/api/star-codes/{code_id}')
def codes_state(code_id:str,data:CodeState,auth=Depends(authorized),session:Session=Depends(m.db)):
    row=session.scalar(select(CoinCode).where(CoinCode.id==code_id).with_for_update())
    if not row:raise HTTPException(404)
    row.enabled=data.enabled;session.add(Audit(id=ident(),admin=auth.username,user_id='',action='star_code_toggle',created_at=int(time.time())));session.commit();return {'ok':True}

@router.get('/admin/user/')
@router.get('/admin/codes/')
def admin_page():
    return FileResponse(Path(__file__).parent/'admin-web'/'stars.html',headers={'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"})

@router.get('/admin/stars.js')
def admin_script():
    return FileResponse(Path(__file__).parent/'admin-web'/'stars.js',media_type='application/javascript')
