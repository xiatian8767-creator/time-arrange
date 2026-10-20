"""Explicit small live-provider QA; synthetic fixture, no user wallet/data writes.

Run inside API container with a synthetic browser-generated fixture path.
Only reports provider/model, proposal types and token counts. Never prints keys.
"""
import json,sys,re
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend import main as m
from backend import assistant as a

messages=(globals().get('fixture') or json.load(open(sys.argv[1],encoding='utf-8')))['messages']
a.validate_messages(messages)
with Session(m.engine) as session:
    endpoints=session.scalars(select(a.Endpoint).where(a.Endpoint.enabled.is_(True),a.Endpoint.vision.is_(True)).order_by(a.Endpoint.created_at)).all()
    providers={}
    for row in endpoints:
        if row.provider not in providers:providers[row.provider]=row
    assert providers,'no configured providers'
    for provider,row in providers.items():
        cfg=SimpleNamespace(provider=row.provider,region=row.region,model=row.model,maxTokens=8192,timeout=90)
        answer=a.provider_call(a.cipher().decrypt(row.secret.encode()).decode(),cfg,messages)
        text=answer['choices'][0]['message']['content'].strip()
        text=re.sub(r'^```(?:json)?\s*|\s*```$','',text)
        proposal=json.loads(text)
        ops=proposal.get('operations',[])
        assert any(op.get('type')=='todo.create' and '报名' in op.get('value',{}).get('title','') and op.get('value',{}).get('dueAt') for op in ops),'provider did not return expected proposal'
        context=json.JSONDecoder().raw_decode(messages[0]['content'].split('当前授权上下文 JSON：',1)[1])[0]
        expected=(datetime.fromtimestamp(context['now']/1000,ZoneInfo('Asia/Shanghai'))+timedelta(days=1)).replace(hour=12,minute=0,second=0,microsecond=0)
        due=next(op['value']['dueAt'] for op in ops if op.get('type')=='todo.create')
        actual=datetime.fromtimestamp(due/1000,ZoneInfo('Asia/Shanghai')) if isinstance(due,(int,float)) else datetime.fromisoformat(due.replace('Z','+00:00'))
        assert actual==expected,'deadline was not tomorrow noon in client timezone'
        print(json.dumps(dict(provider=provider,model=row.model,operationTypes=[op.get('type') for op in ops],promptTokens=answer.get('usage',{}).get('prompt_tokens'),outputTokens=answer.get('usage',{}).get('completion_tokens'),result='PASS'),ensure_ascii=True))
