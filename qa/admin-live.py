"""Explicit operator smoke test. Password from stdin; TLS verified with test CA."""
import sys, secrets, ssl
import httpx

context=ssl.create_default_context(cafile='dist/xingke-ip-test-ca.crt')
with httpx.Client(base_url='https://8.154.43.154',verify=context,timeout=30) as c:
    assert c.get('/admin/').status_code==200
    assert c.get('/admin/api/users').status_code==401
    r=c.post('/admin/api/login',json={'username':'xiatian','password':sys.stdin.readline().strip()})
    assert r.status_code==200, r.status_code
    csrf=r.json()['csrf']
    name='qa_b4_'+secrets.token_hex(4)
    old=secrets.token_urlsafe(24);new=secrets.token_urlsafe(24)
    r=c.post('/api/v1/auth/register',json={'username':name,'password':old,'nickname':'Beta4 验证账号'})
    assert r.status_code==201, r.status_code
    auth=r.json();uid=auth['user']['userId']
    assert len(c.get('/admin/api/users',params={'q':name}).json()['users'])==1
    path='/admin/api/users/'+uid+'/password'
    assert c.post(path,json={'password':new}).status_code==403
    assert c.post(path,json={'password':new},headers={'X-CSRF-Token':csrf}).status_code==200
    assert c.get('/api/v1/me/data',headers={'Authorization':'Bearer '+auth['accessToken']}).status_code==401
    assert c.post('/api/v1/auth/login',json={'username':name,'password':old}).status_code==401
    r=c.post('/api/v1/auth/login',json={'username':name,'password':new});assert r.status_code==200
    assert c.post('/api/v1/auth/logout',headers={'Authorization':'Bearer '+r.json()['accessToken']}).status_code==200
    assert c.post('/admin/api/logout',json={},headers={'X-CSRF-Token':csrf}).status_code==200
    assert c.get('/admin/api/users').status_code==401
    print('PASS HTTPS admin login/search/CSRF/reset/revocation/logout; QA user:',name)
