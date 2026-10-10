import base64
import io
import secrets
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,select,func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from backend import main as m
from backend.admin import Admin,Audit
from backend.feedback import Feedback

@pytest.fixture
def client():
    old=m.engine;m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool);m.limits.clear()
    with TestClient(m.app,base_url='https://testserver') as client:
        with Session(m.engine) as s:s.add(Admin(username='operator',password_hash=m.passwords.hash('admin-test-password')));s.commit()
        yield client
    m.engine.dispose();m.engine=old

def payload(**changes):
    image=Image.new('RGB',(64,48),'gold');out=io.BytesIO();image.save(out,'JPEG',exif=b'')
    return {'requestId':secrets.token_hex(16),'description':'测试问题 <script>alert(1)</script>','contact':'测试邮箱@example.com','images':['data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()],**changes}

def login(client):
    result=client.post('/admin/api/login',json={'username':'operator','password':'admin-test-password'});assert result.status_code==200
    return {'X-CSRF-Token':result.json()['csrf']}

def test_feedback_private_images_and_processing(client):
    data=payload();result=client.post('/feedback/api',json=data,headers={'Origin':'https://testserver'});assert result.status_code==201;id=result.json()['feedbackId']
    assert client.post('/feedback/api',json=data).json()['feedbackId']==id
    for path in ['/admin/api/feedback','/admin/api/feedback/'+id,'/admin/api/feedback/'+id+'/images/0']:
        assert client.get(path).status_code==401
    assert client.get('/feedback/'+id).status_code==404
    csrf=login(client);result=client.get('/admin/api/feedback').json();assert len(result['feedback'])==1;assert result['counts']=={'pending':1,'processing':0,'completed':0};assert 'images' not in result['feedback'][0]
    result=client.get('/admin/api/feedback/'+id).json();assert result['contact']==data['contact'];assert result['imageCount']==1
    image=client.get('/admin/api/feedback/'+id+'/images/0');assert image.headers['content-type']=='image/jpeg';assert image.headers['cache-control']=='no-store';assert Image.open(io.BytesIO(image.content)).size==(64,48)
    assert client.post('/admin/api/feedback/'+id,json={'status':'processing','revision':1}).status_code==403
    for revision,state in enumerate(['processing','completed','pending'],1):
        result=client.post('/admin/api/feedback/'+id,json={'status':state,'revision':revision,'note':'已联系用户'},headers=csrf);assert result.status_code==200;assert result.json()['revision']==revision+1
        assert client.get('/admin/api/feedback?status='+state).json()['feedback'][0]['status']==state
    assert client.post('/admin/api/feedback/'+id,json={'status':'completed','revision':1},headers=csrf).status_code==409
    with Session(m.engine) as s:assert s.scalar(select(func.count()).select_from(Audit))==3
    assert client.post('/admin/api/logout',json={},headers=csrf).status_code==200
    assert client.get('/admin/api/feedback/'+id+'/images/0').status_code==401

def test_feedback_validation_and_limits(client):
    for changes in [{'description':'   '},{'contact':' '},{'images':['data:image/jpeg;base64,bm90LWFuLWltYWdl']},{'images':payload()['images']*4},{'website':'spam'},{'description':'x'*4001}]:
        assert client.post('/feedback/api',json=payload(**changes)).status_code==422
    assert client.post('/feedback/api',json=payload(),headers={'Origin':'https://evil.example'}).status_code==403
    m.limits.clear()
    for _ in range(5):assert client.post('/feedback/api',json=payload(images=[])).status_code==201
    assert client.post('/feedback/api',json=payload(images=[])).status_code==429
    assert client.post('/feedback/api',content=b'x'*(1024*1024+1),headers={'Content-Type':'application/json'}).status_code==413
    csrf=login(client)
    assert client.get('/admin/api/feedback?status=unknown').status_code==422
    assert client.get('/admin/api/feedback?offset=-1').status_code==422
    id=client.get('/admin/api/feedback').json()['feedback'][0]['id']
    assert client.post('/admin/api/feedback/'+id,json={'status':'unknown','revision':1},headers=csrf).status_code==422
