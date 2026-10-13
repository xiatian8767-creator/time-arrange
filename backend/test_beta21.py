import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, delete
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from backend import main as m
from backend.admin import Admin
from backend.security import Recovery
from backend.campaigns import Campaign, Receipt, period

@pytest.fixture
def client():
    original=m.engine
    m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    m.limits.clear()
    with TestClient(m.app,base_url='https://testserver') as c: yield c
    m.engine.dispose();m.engine=original

def user(c,name='betauser'):
    r=c.post('/api/v1/auth/register',json={'username':name,'password':'old-test-password','nickname':name})
    assert r.status_code==201,r.text
    data=r.json()
    return data,{'Authorization':'Bearer '+data['accessToken']}

def operator(c):
    with Session(m.engine) as s:
        s.add(Admin(username='operator',password_hash=m.passwords.hash('operator-password')));s.commit()
    r=c.post('/admin/api/login',json={'username':'operator','password':'operator-password'})
    assert r.status_code==200,r.text
    return {'X-CSRF-Token':r.json()['csrf']}

def setup(c,h):
    payload={'password':'old-test-password','question1':'place','question2':'phrase','answer1':'My Town','answer2':'Secret Words'}
    r=c.post('/api/v1/me/security',headers=h,json=payload)
    assert r.status_code==200,r.text

def test_recovery_setup_reset_revokes_and_keeps_document(client):
    account,h=user(client)
    assert client.get('/api/v1/me/security',headers=h).json()['required'] is True
    assert client.get('/api/v1/me/security').status_code==401
    setup(client,h)
    result=client.get('/api/v1/me/security',headers=h).json()
    assert result['configured'] and not result['required']
    assert 'answer' not in str(result)
    with Session(m.engine) as s:
        row=s.get(Recovery,account['user']['userId']);assert row.answer1.startswith('$argon2') and 'My Town' not in row.answer1
        before=s.get(m.User,account['user']['userId']).document
    assert len(client.post('/api/v1/auth/recovery/questions',json={'username':'BETAUSER'}).json()['questions'])==2
    reset={'username':'betauser','answer1':'  MY   TOWN ','answer2':'secret words','password':'new-test-password'}
    assert client.post('/api/v1/auth/recovery/reset',json={**reset,'answer1':'incorrect'}).status_code==400
    assert client.post('/api/v1/auth/recovery/reset',json=reset).status_code==200
    assert client.get('/api/v1/me/data',headers=h).status_code==401
    assert client.post('/api/v1/auth/refresh',json={'refreshToken':account['refreshToken']}).status_code==401
    assert client.post('/api/v1/auth/login',json={'username':'betauser','password':'new-test-password'}).status_code==200
    with Session(m.engine) as s: assert s.get(m.User,account['user']['userId']).document==before

def test_existing_account_optional_setup_and_persistent_lockout(client):
    account,h=user(client)
    with Session(m.engine) as s:s.execute(delete(Recovery));s.commit()
    status=client.get('/api/v1/me/security',headers=h).json()
    assert not status['required'] and not status['configured']
    setup(client,h)
    reset={'username':'betauser','answer1':'incorrect','answer2':'incorrect','password':'new-test-password'}
    for _ in range(5):
        m.limits.clear()
        assert client.post('/api/v1/auth/recovery/reset',json=reset).status_code==400
    m.limits.clear()
    assert client.post('/api/v1/auth/recovery/reset',json={**reset,'answer1':'my town','answer2':'secret words'}).status_code==429

def test_campaign_target_time_receipts_and_admin_permissions(client):
    a,ah=user(client,'firstuser');_,bh=user(client,'seconduser')
    body={'title':'更新','url':'https://example.com/event','width':88,'height':65,'audience':'custom','userIds':[a['user']['userId']],'startsAt':int(time.time()*1000)+60000,'frequency':'once','enabled':True}
    assert client.post('/admin/api/campaigns',json=body).status_code==401
    csrf=operator(client)
    assert client.post('/admin/api/campaigns',json=body).status_code==403
    created=client.post('/admin/api/campaigns',headers=csrf,json=body)
    assert created.status_code==200,created.text
    campaign=created.json();path='/admin/api/campaigns/'+campaign['id']
    assert client.get('/api/v1/campaigns',headers=ah).json()['campaign'] is None
    body.update(startsAt=0,revision=campaign['revision'])
    assert client.post(path,headers=csrf,json=body).status_code==200
    assert client.post(path,headers=csrf,json=body).status_code==409
    assert client.get('/api/v1/campaigns',headers=bh).json()['campaign'] is None
    pending=client.get('/api/v1/campaigns',headers=ah).json()
    assert pending['campaign']['id']==campaign['id'] and 'userIds' not in pending['campaign']
    receipt='/api/v1/campaigns/'+campaign['id']+'/displayed'
    assert client.post(receipt,headers=bh,json={}).status_code==404
    assert client.post(receipt,headers=ah,json={}).status_code==200
    assert client.post(receipt,headers=ah,json={}).status_code==200
    assert client.get('/api/v1/campaigns',headers=ah).json()['campaign'] is None
    with Session(m.engine) as s: assert len(s.scalars(select(Receipt)).all())==1
    assert client.post('/admin/api/campaigns',headers=csrf,json={**body,'url':'http://example.com/event'}).status_code==200
    for url in ['http://127.0.0.1','https://127.0.0.1','https://appassets.androidplatform.net/assets/index.html','javascript:alert(1)','https://user:password@example.com']:
        assert client.post('/admin/api/campaigns',headers=csrf,json={**body,'url':url}).status_code==422

def test_campaign_period_boundaries():
    from datetime import datetime
    millis=lambda x:int(datetime.fromisoformat(x).timestamp()*1000)
    row=Campaign(frequency='daily')
    assert period(row,millis('2026-10-12T23:59:00+08:00'))=='d:2026-10-12'
    assert period(row,millis('2026-10-13T00:00:00+08:00'))=='d:2026-10-13'
    row.frequency='weekly'
    assert period(row,millis('2026-10-11T23:59:00+08:00'))!=period(row,millis('2026-10-12T00:00:00+08:00'))
