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
    name='qa_v21_'+secrets.token_hex(4)
    old=secrets.token_urlsafe(24);new=secrets.token_urlsafe(24)
    r=c.post('/api/v1/auth/register',json={'username':name,'password':old,'nickname':'Beta4 验证账号'})
    assert r.status_code==201, r.status_code
    auth=r.json();uid=auth['user']['userId']
    header={'Authorization':'Bearer '+auth['accessToken']}
    doc={'version':2,'slots':[{'id':'s1','start':'08:00','end':'08:45'}],'courses':[],'todos':[{'id':'qa-task','title':'测试待办','dueAt':1900000000000,'createdAt':1800000000000,'priority':'normal','note':'','completed':False,'remind':True,'alarmEnabled':True,'alarmAt':1899999700000}]}
    assert c.put('/api/v1/me/data',headers=header,json={'baseRevision':0,'document':doc}).status_code==200
    assert c.get('/api/v1/me/data',headers=header).json()['document']['todos'][0]['alarmEnabled'] is True
    del doc['todos'][0]['alarmEnabled'];del doc['todos'][0]['alarmAt']
    assert c.put('/api/v1/me/data',headers=header,json={'baseRevision':1,'document':doc}).status_code==200
    assert c.get('/api/v1/me/data',headers=header).json()['document']['todos'][0]['alarmAt']==1899999700000
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
