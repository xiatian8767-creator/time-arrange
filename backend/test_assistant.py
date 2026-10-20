"""Assistant-only tests. No production data or model credentials are used."""
import json
import secrets
import time
from datetime import datetime
from decimal import Decimal
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from backend import main as m
from backend import assistant as a
from backend.admin import Admin
from backend.stars import Wallet, Transaction, change, lock_users

@pytest.fixture
def client(tmp_path,monkeypatch):
    original=m.engine;m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    m.limits.clear();a.rotation=0;key=tmp_path/'key';key.write_bytes(Fernet.generate_key());monkeypatch.setenv('AI_KEY_FILE',str(key))
    with TestClient(m.app,base_url='https://testserver') as c:yield c
    m.engine.dispose();m.engine=original

def account(c,name='aiuser',coins=100):
    r=c.post('/api/v1/auth/register',json={'username':name,'nickname':name,'password':'test-password-1234'});assert r.status_code==201,r.text
    data=r.json();uid=data['user']['userId']
    with Session(m.engine) as s:s.add(Wallet(user_id=uid,balance=coins));s.commit()
    return uid,{'Authorization':'Bearer '+data['accessToken']}

def admin(c):
    with Session(m.engine) as s:s.add(Admin(username='aiadmin',password_hash=m.passwords.hash('test-password-1234')));s.commit()
    d=c.post('/admin/api/login',json={'username':'aiadmin','password':'test-password-1234'}).json()
    return {'X-CSRF-Token':d['csrf']}

def setup(c,csrf,**extra):
    body={'enabled':True,'apiKey':'sk-test-only-not-real','period':'peak',**extra}
    r=c.post('/admin/api/assistant',json=body,headers=csrf);assert r.status_code==200,r.text

def payload(**extra):return {'requestId':secrets.token_hex(16),'messages':[{'role':'user','content':'帮我安排明天'}],**extra}

def response(prompt=1000,hit=200,out=100):return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'message':'你好，先确认具体时间吧。','warnings':[],'operations':[]},ensure_ascii=False)}}],'usage':{'prompt_tokens':prompt,'prompt_cache_hit_tokens':hit,'prompt_cache_miss_tokens':prompt-hit,'completion_tokens':out}}

def balance(c,h):return c.get('/api/v1/stars',headers=h).json()['balance']

def test_admin_credentials_encrypted_csrf_and_defaults(client):
    c=client;uid,h=account(c)
    assert c.get('/admin/api/assistant').status_code==401
    csrf=admin(c)
    assert c.post('/admin/api/assistant',json={'enabled':True,'apiKey':'sk-test-only-not-real'}).status_code==403
    setup(c,csrf)
    d=c.get('/admin/api/assistant').json();assert d['hasKey'] and d['multiplier']=='5' and d['coinsPerYuan']==100
    assert 'sk-test' not in json.dumps(d)
    with Session(m.engine) as s:assert 'sk-test' not in s.get(a.Endpoint,'legacy-default').secret
    assert 'apiKey' not in c.get('/api/v1/ai/status',headers=h).text
    assert c.post('/admin/api/assistant',json={'enabled':True,'apiKey':''},headers=csrf).status_code==200
    assert c.get('/admin/api/assistant').json()['hasKey']
    for value in ['NaN','Infinity','-1','0']:
        assert c.post('/admin/api/assistant',json={'multiplier':value},headers=csrf).status_code==422

def test_price_actual_cached_peak_offpeak_and_ceil():
    r=a.Rules()
    usage={'prompt_tokens':1000000,'prompt_cache_hit_tokens':250000,'completion_tokens':100000}
    assert a.price(usage,r,'peak')[0]==1155
    assert a.price(usage,r,'off')[0]==578
    assert a.price({'prompt_tokens':1,'completion_tokens':1},r,'peak')[0]==1
    assert a.price({'prompt_tokens':1000000,'prompt_tokens_details':{'cached_tokens':1000000},'completion_tokens':0},r,'off')[0]==10
    with pytest.raises(ValueError):a.price({'prompt_tokens':1,'completion_tokens':True},r,'off')
    with pytest.raises(ValueError):a.price({'prompt_tokens':1,'prompt_cache_hit_tokens':2,'completion_tokens':1},r,'off')
    with pytest.raises(ValueError):a.price({},r,'off')
    assert a.period_at(r,int(datetime(2026,10,20,9,30,tzinfo=a.TZ).timestamp()*1000))=='peak'
    assert a.period_at(r,int(datetime(2026,10,20,12,0,tzinfo=a.TZ).timestamp()*1000))=='off'
    assert a.period_at(r,int(datetime(2026,10,1,10,0,tzinfo=a.TZ).timestamp()*1000))=='off'

def test_success_idempotent_and_owner_scoped(client,monkeypatch):
    c=client;uid,h=account(c);other,oh=account(c,'other');csrf=admin(c);setup(c,csrf)
    calls=[]
    def fake(key,rules,messages):calls.append(key);return response()
    monkeypatch.setattr(a,'provider_call',fake)
    body=payload();r=c.post('/api/v1/ai/chat',headers=h,json=body);assert r.status_code==200,r.text
    assert r.json()['billing']['coins']==2 and balance(c,h)==98
    assert c.post('/api/v1/ai/chat',headers=h,json=body).json()==r.json();assert len(calls)==1
    assert c.get('/api/v1/ai/requests/'+body['requestId'],headers=h).json()==r.json()
    assert c.get('/api/v1/ai/requests/'+body['requestId'],headers=oh).status_code==404
    assert c.post('/api/v1/ai/chat',headers=h,json={**body,'messages':[{'role':'user','content':'changed'}]}).status_code==409
    tx=c.get('/api/v1/stars/transactions',headers=h).json()['transactions'];assert len(tx)==1 and tx[0]['kind']=='ai_chat' and tx[0]['amount']==-2
    assert 'sk-test' not in c.get('/admin/api/assistant/usage').text

@pytest.mark.parametrize('kind',['exception','usage','length','overrun'])
def test_failed_calls_refund_and_no_transaction(client,monkeypatch,kind):
    c=client;uid,h=account(c);csrf=admin(c);setup(c,csrf)
    def fake(*args):
        if kind=='exception':raise RuntimeError('sensitive-provider-error-sk-DO-NOT-LEAK')
        d=response()
        if kind=='usage':d.pop('usage')
        if kind=='length':d['choices'][0]['finish_reason']='length'
        if kind=='overrun':d=response(prompt=1000000,out=100000)
        return d
    monkeypatch.setattr(a,'provider_call',fake)
    r=c.post('/api/v1/ai/chat',headers=h,json=payload());assert r.status_code==502,r.text
    assert balance(c,h)==100 and 'sensitive' not in r.text
    assert c.get('/api/v1/stars/transactions',headers=h).json()['transactions']==[]

def test_unavailable_balance_and_invalid_images_never_call_model(client,monkeypatch):
    c=client;uid,h=account(c,coins=0);csrf=admin(c)
    monkeypatch.setattr(a,'provider_call',lambda *args:pytest.fail('must not contact provider'))
    assert c.post('/api/v1/ai/chat',json=payload()).status_code==401
    assert c.post('/api/v1/ai/chat',headers=h,json=payload()).status_code==503
    setup(c,csrf)
    assert c.post('/api/v1/ai/chat',headers=h,json=payload()).status_code==402
    for url in ['http://169.254.169.254/','https://example.com/photo.png','data:image/jpeg;base64,INVALID']:
        body=payload(messages=[{'role':'user','content':[{'type':'image_url','image_url':{'url':url}}]}])
        assert c.post('/api/v1/ai/chat',headers=h,json=body).status_code==422
    body=payload(messages=[{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,YQ=='}}]*11}])
    assert c.post('/api/v1/ai/chat',headers=h,json=body).status_code==422

def test_auto_correction_rounds_combined_tokens_once(client,monkeypatch):
    c=client;uid,h=account(c,coins=1);csrf=admin(c);setup(c,csrf)
    monkeypatch.setattr(a,'provider_call',lambda *args:response(prompt=10,hit=0,out=10))
    first=payload();d=c.post('/api/v1/ai/chat',headers=h,json=first).json();assert d['billing']['coins']==1
    follow=payload(continuationOf=first['requestId'],messages=[*first['messages'],d['choices'][0]['message'],{'role':'user','content':'请校正格式'}])
    # Only role/content are sent by the client; choices messages have exactly those fields.
    result=c.post('/api/v1/ai/chat',headers=h,json=follow);assert result.status_code==200,result.text
    assert result.json()['billing']['coins']==0 and balance(c,h)==0
    assert c.post('/api/v1/ai/chat',headers=h,json={**follow,'requestId':secrets.token_hex(16)}).status_code==409

def test_stale_reservation_recovered_and_grant_cannot_overflow(client):
    c=client;uid,h=account(c,coins=999999900)
    with Session(m.engine) as s:
        s.add(a.Call(id='stale',user_id=uid,fingerprint='x',state='pending',reserved=100,created_at=a.now()-a.STALE_MS-1));s.commit()
        lock_users(s,[uid])
        with pytest.raises(Exception):change(s,uid,1,'op','admin_grant')
        s.rollback()
    assert c.get('/api/v1/ai/status',headers=h).json()['balance']==1000000000
    assert c.get('/api/v1/ai/status',headers=h).json()['balance']==1000000000
