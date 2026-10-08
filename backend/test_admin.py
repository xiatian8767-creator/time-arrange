from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from backend import main as m
from backend.admin import Admin, Audit

def test_admin_access_search_reset_and_revocation():
    original=m.engine;m.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool);m.limits.clear()
    try:
        with TestClient(m.app,base_url='https://testserver') as c:
            with Session(m.engine) as s:s.add(Admin(username='operator',password_hash=m.passwords.hash('admin-test-password')));s.commit()
            user=c.post('/api/v1/auth/register',json={'username':'testalice','password':'old-password-test','nickname':'Alice <script>'}).json()
            assert c.get('/admin/api/users').status_code==401
            assert c.post('/admin/api/login',json={'username':'testalice','password':'old-password-test'}).status_code==401
            login=c.post('/admin/api/login',json={'username':'operator','password':'admin-test-password'})
            assert login.status_code==200
            assert 'HttpOnly' in login.headers['set-cookie'] and 'Secure' in login.headers['set-cookie']
            csrf={'X-CSRF-Token':login.json()['csrf']}
            found=c.get('/admin/api/users?q=alice').json();assert found['users'][0]['userId']==user['user']['userId'];assert 'password' not in str(found)
            assert c.get('/admin/api/users?q=%25').json()['users']==[]
            route='/admin/api/users/'+user['user']['userId']+'/password'
            assert c.post(route,json={'password':'new-password-test'}).status_code==403
            assert c.post(route,headers=csrf,json={'password':'new-password-test'}).status_code==200
            assert c.get('/api/v1/me/data',headers={'Authorization':'Bearer '+user['accessToken']}).status_code==401
            assert c.post('/api/v1/auth/refresh',json={'refreshToken':user['refreshToken']}).status_code==401
            assert c.post('/api/v1/auth/login',json={'username':'testalice','password':'old-password-test'}).status_code==401
            assert c.post('/api/v1/auth/login',json={'username':'testalice','password':'new-password-test'}).status_code==200
            with Session(m.engine) as s:assert len(s.scalars(select(Audit)).all())==1
            assert c.post('/admin/api/logout',headers=csrf,json={}).status_code==200
            assert c.get('/admin/api/users').status_code==401
    finally:m.engine.dispose();m.engine=original
