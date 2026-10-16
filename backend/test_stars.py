"""Only 3.3 additions. Optional STAR_TEST_DATABASE_URL targets an isolated PostgreSQL DB."""
import os
import io
import base64
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from backend import main as m
from backend.admin import Admin
from backend.stars import Wallet, Transaction, StarMessage, Redemption

@pytest.fixture
def client():
    original=m.engine
    url=os.environ.get('STAR_TEST_DATABASE_URL')
    if url:
        # Never accept the production database name for destructive test setup.
        assert url.rsplit('/',1)[-1].startswith('star_test_')
        m.engine=create_engine(url,pool_pre_ping=True)
        m.Base.metadata.drop_all(m.engine)
    else:m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    m.limits.clear()
    with TestClient(m.app,base_url='https://testserver') as c:yield c
    if url:m.Base.metadata.drop_all(m.engine)
    m.engine.dispose();m.engine=original

def key():return secrets.token_hex(16)
def post(c,path,body,h=None):
    r=c.post(path,json=body,headers=h or {});assert r.status_code==200,r.text;return r.json()
def user(c,name):
    r=c.post('/api/v1/auth/register',json={'username':name,'nickname':name,'password':'test-password-1234'})
    assert r.status_code==201,r.text
    d=r.json();return d['user']['userId'],{'Authorization':'Bearer '+d['accessToken']}
def admin(c):
    with Session(m.engine) as s:s.add(Admin(username='tester',password_hash=m.passwords.hash('test-password-1234')));s.commit()
    d=post(c,'/admin/api/login',{'username':'tester','password':'test-password-1234'});return {'X-CSRF-Token':d['csrf']}
def bind(a,b):
    with Session(m.engine) as s:s.get(m.User,a).partner_id=b;s.get(m.User,b).partner_id=a;s.commit()
def balance(c,h):return c.get('/api/v1/stars',headers=h).json()['balance']
def grant(c,a,csrf,n=10,**extra):return post(c,'/admin/api/users/'+a+'/stars',{'requestId':key(),'amount':n,**extra},csrf)
def picture():
    b=io.BytesIO();Image.new('RGB',(10,10),'gold').save(b,'JPEG');return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()

def test_wallet_gift_atomic_idempotent_and_scope(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');z,zh=user(c,'outsider');csrf=admin(c);bind(a,b)
    assert balance(c,ah)==0
    body={'requestId':key(),'amount':10}
    assert c.post('/admin/api/users/'+a+'/stars',json=body).status_code==403
    post(c,'/admin/api/users/'+a+'/stars',body,csrf);post(c,'/admin/api/users/'+a+'/stars',body,csrf)
    assert balance(c,ah)==10
    gift={'requestId':key(),'partnerId':b,'amount':4,'note':'你好'}
    post(c,'/api/v1/stars/gift',gift,ah);post(c,'/api/v1/stars/gift',gift,ah)
    assert (balance(c,ah),balance(c,bh))==(6,4)
    assert c.post('/api/v1/stars/gift',headers=ah,json={**gift,'amount':5}).status_code==409
    assert c.post('/api/v1/stars/gift',headers=ah,json={**gift,'requestId':key(),'amount':7}).status_code==409
    assert c.post('/api/v1/stars/gift',headers=zh,json={**gift,'requestId':key()}).status_code==409
    for n in [0,-1,1.5,True]:assert c.post('/api/v1/stars/gift',headers=ah,json={**gift,'requestId':key(),'amount':n}).status_code==422
    assert balance(c,ah)==6
    assert len(c.get('/api/v1/stars/transactions',headers=bh).json()['transactions'])==1

def test_codes_single_reusable_and_disabled(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');csrf=admin(c)
    payload={'requestId':key(),'count':2,'amount':7,'reusable':False}
    codes=post(c,'/admin/api/star-codes',payload,csrf)['codes'];assert post(c,'/admin/api/star-codes',payload,csrf)['codes']==codes
    body={'requestId':key(),'code':codes[0].lower()}
    assert post(c,'/api/v1/stars/redeem',body,ah)['balance']==7
    assert post(c,'/api/v1/stars/redeem',body,ah)['balance']==7
    assert c.post('/api/v1/stars/redeem',headers=bh,json={**body,'requestId':key()}).status_code==409
    reusable=post(c,'/admin/api/star-codes',{'requestId':key(),'count':1,'amount':3,'reusable':True},csrf)['codes'][0]
    for h in [ah,bh]:post(c,'/api/v1/stars/redeem',{'requestId':key(),'code':reusable},h)
    assert c.post('/api/v1/stars/redeem',headers=ah,json={'requestId':key(),'code':reusable}).status_code==409
    row=next(r for r in c.get('/admin/api/star-codes').json()['codes'] if r['code']==codes[1])
    post(c,'/admin/api/star-codes/'+row['id'],{'enabled':False},csrf)
    assert c.post('/api/v1/stars/redeem',headers=ah,json={'requestId':key(),'code':codes[1]}).status_code==422
    assert balance(c,ah)==10 and balance(c,bh)==3

def test_profile_detail_backup_and_scheduled_message(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');csrf=admin(c);bind(a,b);grant(c,a,csrf)
    post(c,'/api/v1/stars/profile',{'version':'3.3beta.1','avatar':picture()},ah)
    assert c.get('/api/v1/stars',headers=bh).json()['partner']['avatar'].startswith('data:image/jpeg;base64,')
    detail=c.get('/admin/api/users/'+a+'/detail').json();assert detail['appVersion']=='3.3beta.1' and detail['partner']['userId']==b
    with Session(m.engine) as s:s.get(m.User,a).document={'version':2,'courses':[],'slots':[],'todos':[]};s.commit()
    backup=c.get('/admin/api/users/'+a+'/backup');assert backup.json()['version']==2 and 'password' not in backup.text
    body={'requestId':key(),'partnerId':b,'message':{'text':'你好 <script>alert(1)</script>','image':picture(),'startsAt':int(time.time()*1000)+60000}}
    post(c,'/api/v1/stars/send',body,ah);post(c,'/api/v1/stars/send',body,ah)
    assert balance(c,ah)==9
    assert c.get('/api/v1/campaigns',headers=bh).json()['campaign'] is None
    templates=c.get('/api/v1/stars/templates',headers=ah).json()['templates'];assert len(templates)==1
    page=c.get('/updates/messages/'+templates[0]['id']+'/');assert '&lt;script&gt;' in page.text and '<script>' not in page.text
    invalid={**body,'requestId':key(),'message':{'text':'bad','image':'data:image/jpeg;base64,broken'}}
    assert c.post('/api/v1/stars/send',headers=ah,json=invalid).status_code==422
    assert balance(c,ah)==9
    post(c,'/api/v1/stars/send',{**body,'requestId':key(),'message':{'text':'复用','templateId':templates[0]['id']}},ah)
    assert balance(c,ah)==8
    assert c.get('/api/v1/campaigns',headers=bh).json()['campaign']
    assert c.get('/api/v1/campaigns',headers=ah).json()['campaign'] is None
    post(c,'/api/v1/stars/profile',{'avatar':None},ah);assert c.get('/api/v1/stars',headers=ah).json()['user']['avatar'] is None

def test_admin_campaign_list_excludes_peer_messages_without_affecting_delivery(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');csrf=admin(c);bind(a,b)
    grant(c,a,csrf,n=10,message={'text':'管理员赠送'})
    post(c,'/api/v1/stars/send',{'requestId':key(),'partnerId':b,'message':{'text':'一起上课'}},ah)
    post(c,'/api/v1/stars/gift',{'requestId':key(),'partnerId':b,'amount':1},ah)
    body={'title':'运营活动','url':'https://example.com/','width':88,'height':65,'audience':'all','startsAt':0,'frequency':'once','enabled':True}
    official=post(c,'/admin/api/campaigns',body,csrf)
    listed=c.get('/admin/api/campaigns').json()['campaigns']
    assert len(listed)==2
    assert {r['title'] for r in listed}=={'运营活动','星币到账'}
    received=c.get('/api/v1/campaigns',headers=bh).json()['campaign']
    assert received and received['id'] not in {r['id'] for r in listed}
    for action in ['reset','delete']:
        assert c.post('/admin/api/campaigns/'+received['id']+'/'+action,json={'revision':received['revision']},headers=csrf).status_code==404
    assert c.post('/admin/api/campaigns/'+received['id'],json={**body,'revision':received['revision']},headers=csrf).status_code==404
    post(c,'/api/v1/campaigns/'+received['id']+'/displayed',{},bh)
    next_item=c.get('/api/v1/campaigns',headers=bh).json()['campaign']
    assert next_item and next_item['id'] not in {received['id'],official['id']}


def test_campaign_reset_and_every_open(client):
    c=client;a,ah=user(c,'alice');csrf=admin(c)
    body={'title':'测试','url':'https://example.com/','width':88,'height':65,'audience':'all','startsAt':0,'frequency':'once','enabled':True}
    row=post(c,'/admin/api/campaigns',body,csrf);path='/api/v1/campaigns/'+row['id']+'/displayed'
    initial=c.get('/api/v1/campaigns',headers=ah).json();post(c,path,{},ah)
    assert c.get('/api/v1/campaigns',headers=ah).json()['campaign'] is None
    row=post(c,'/admin/api/campaigns/'+row['id']+'/reset',{'revision':row['revision']},csrf)
    assert post(c,path,{'period':initial['period']},ah)['stale'] is True
    assert c.get('/api/v1/campaigns',headers=ah).json()['period']!=initial['period']
    row=post(c,'/admin/api/campaigns/'+row['id'],{**body,'frequency':'always','revision':row['revision']},csrf)
    first=c.get('/api/v1/campaigns',headers=ah).json();post(c,path,{},ah)
    second=c.get('/api/v1/campaigns',headers=ah).json();assert first['period']!=second['period'] and second['campaign']
    assert c.get('/api/v1/campaigns?skip='+row['id'],headers=ah).json()['campaign'] is None

@pytest.mark.skipif(not os.environ.get('STAR_TEST_DATABASE_URL'),reason='PostgreSQL concurrency test requires isolated DB')
def test_concurrent_balance_and_redeem(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');csrf=admin(c);bind(a,b);grant(c,a,csrf,n=5)
    def gift(_):return c.post('/api/v1/stars/gift',headers=ah,json={'requestId':key(),'partnerId':b,'amount':1}).status_code
    with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(gift,range(12)))
    assert results.count(200)==5 and results.count(409)==7
    assert balance(c,ah)==0 and balance(c,bh)==5
    code=post(c,'/admin/api/star-codes',{'requestId':key(),'amount':7,'count':1},csrf)['codes'][0]
    def redeem(h):return c.post('/api/v1/stars/redeem',headers=h,json={'requestId':key(),'code':code}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(redeem,[ah,bh]))
    assert sorted(results)==[200,409]
    assert balance(c,ah)+balance(c,bh)==12

def test_admin_grant_popup_and_backup_access(client):
    c=client;a,ah=user(c,'alice');csrf=admin(c)
    assert c.get('/admin/api/users/'+a+'/backup').status_code==404
    grant(c,a,csrf,n=8,message={'text':'赠送八枚星币','image':picture(),'background':'#ffeedd','color':'#112233'})
    item=c.get('/api/v1/campaigns',headers=ah).json()['campaign'];assert item and item['width']==68 and item['height']==48
    from urllib.parse import urlsplit
    r=c.get(urlsplit(item['url']).path);assert 'class="coin"' in r.text and '+8' in r.text and 'starorbit://campaign/close' in r.text
    preview=post(c,'/admin/api/star-preview',{'amount':8,'text':'赠送八枚星币','image':picture()},csrf)['html']
    assert 'class="coin"' in preview and '+8' in preview and 'data:image/jpeg;base64,' in preview
    c.cookies.clear()
    assert c.get('/admin/api/users/'+a+'/detail',headers=ah).status_code==401
    assert c.get('/admin/api/users/'+a+'/backup',headers=ah).status_code==401
    assert c.get('/admin/api/star-codes',headers=ah).status_code==401
    assert c.get('/api/v1/stars').status_code==401

def test_custom_gift_picture_and_template(client):
    c=client;a,ah=user(c,'alice');b,bh=user(c,'bob');csrf=admin(c);bind(a,b);grant(c,a,csrf)
    post(c,'/api/v1/stars/gift',{'requestId':key(),'partnerId':b,'amount':5,'note':'一起努力 ✨','image':picture()},ah)
    campaign=c.get('/api/v1/campaigns',headers=bh).json()['campaign']
    from urllib.parse import urlsplit
    page=c.get(urlsplit(campaign['url']).path)
    assert '一起努力 ✨' in page.text and '+5' in page.text and 'alice' in page.text and '/asset' in page.text
    assert campaign['width']==68 and campaign['height']==48
    assert balance(c,ah)==5 and balance(c,bh)==5
