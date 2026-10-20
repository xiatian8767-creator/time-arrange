"""API pool/failover, credential migration, shared billing and admin separation."""
import io
import json
import secrets
import urllib.error
from types import SimpleNamespace
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from backend import main as m
from backend import assistant as a
from backend.test_assistant import client, account, admin, setup, response, payload, balance

def add(c,csrf,name,provider='deepseek',**extra):
    body={'name':name,'provider':provider,'model':'qwen3-vl-plus' if provider=='qwen' else 'deepseek-flash','apiKey':'sk-test-'+name,**extra}
    r=c.post('/admin/api/assistant/apis',headers=csrf,json=body);assert r.status_code==200,r.text
    return r.json()

def enabled(c,csrf):
    r=c.post('/admin/api/assistant/rules',headers=csrf,json={'enabled':True,'period':'peak'});assert r.status_code==200,r.text

def error(status):return urllib.error.HTTPError('https://official.invalid/',status,'sensitive-error',None,io.BytesIO(b'{"error":{"code":"upstream_error"}}'))

def test_apis_crud_security_and_billing_are_separate(client):
    c=client;uid,h=account(c);csrf=admin(c)
    entry=add(c,csrf,'primary');assert entry['hasKey'] and 'apiKey' not in entry and 'secret' not in entry
    assert 'sk-test-primary' not in c.get('/admin/api/assistant/apis').text
    with Session(m.engine) as s:assert 'sk-test' not in s.get(a.Endpoint,entry['id']).secret
    body={k:entry[k] for k in ['name','provider','region','model','enabled','supportsImages','timeoutSeconds']}
    assert c.post('/admin/api/assistant/apis/'+entry['id'],json=body).status_code==403
    assert c.post('/admin/api/assistant/apis/'+entry['id'],json={**body,'name':'renamed'},headers=csrf).status_code==200
    assert c.post('/admin/api/assistant/apis/'+entry['id'],json={**body,'provider':'qwen','model':'qwen3-vl-plus'},headers=csrf).status_code==422
    assert c.post('/admin/api/assistant/apis',headers=csrf,json={**body,'apiKey':'sk-test','baseUrl':'http://169.254.169.254'}).status_code==422
    enabled(c,csrf);d=c.get('/admin/api/assistant/rules').json();assert d['multiplier']=='5' and d['coinsPerYuan']==100
    assert not any(k in d for k in ('apiKey','secret','model','provider'))
    assert c.delete('/admin/api/assistant/apis/'+entry['id']).status_code==403
    assert c.delete('/admin/api/assistant/apis/'+entry['id'],headers=csrf).status_code==200
    assert c.get('/api/v1/ai/status',headers=h).json()['enabled'] is False

def test_round_robin_qwen_cache_and_one_rate_card(client,monkeypatch):
    c=client;uid,h=account(c);csrf=admin(c)
    add(c,csrf,'a');add(c,csrf,'b','qwen');enabled(c,csrf);used=[]
    def fake(key,settings,messages):
        used.append(settings.provider);d=response()
        if settings.provider=='qwen':d['usage']={'prompt_tokens':1000,'completion_tokens':100,'prompt_tokens_details':{'cached_tokens':200}}
        return d
    monkeypatch.setattr(a,'provider_call',fake)
    for _ in range(3):
        r=c.post('/api/v1/ai/chat',headers=h,json=payload());assert r.status_code==200,r.text
        assert r.json()['billing']['coins']==2
        assert 'provider' not in r.json()['billing'] and 'apiName' not in r.json()['billing']
    assert used[0]==used[2] and used[0]!=used[1] and set(used)=={'deepseek','qwen'}
    assert balance(c,h)==94
    rows=c.get('/admin/api/assistant/usage?q=aiuser&state=done').json()['calls'];assert len(rows)==3
    assert all(len(r['attempts'])==1 for r in rows)
    assert c.get('/admin/api/assistant/usage?q=not-a-user').json()['calls']==[]

@pytest.mark.parametrize('status',[401,402,403,429,500,503,0,'format'])
def test_failed_key_falls_back_and_cools_without_extra_charge(client,monkeypatch,status):
    c=client;uid,h=account(c);csrf=admin(c);bad=add(c,csrf,'bad');good=add(c,csrf,'good','qwen');enabled(c,csrf)
    # Force deterministic pool order, independently of generated endpoint IDs.
    with Session(m.engine) as s:s.get(a.Endpoint,bad['id']).created_at=1;s.get(a.Endpoint,good['id']).created_at=2;s.commit()
    used=[]
    def fake(key,settings,messages):
        used.append(key)
        if key.endswith('bad'):
            if status==0:raise TimeoutError()
            if status=='format':return {'choices':[]}
            raise error(status)
        return response()
    monkeypatch.setattr(a,'provider_call',fake)
    body=payload();r=c.post('/api/v1/ai/chat',headers=h,json=body);assert r.status_code==200,r.text
    assert r.json()['billing']['coins']==2 and balance(c,h)==98
    assert used==['sk-test-bad','sk-test-good']
    assert c.post('/api/v1/ai/chat',headers=h,json=body).json()==r.json();assert len(used)==2
    data=c.get('/admin/api/assistant/apis').json()['apis'];bad_state=next(x for x in data if x['id']==bad['id'])
    assert bad_state['cooldownUntil']>a.now() and bad_state['failures']==1
    history=c.get('/admin/api/assistant/usage').json()['calls'];assert len(history[0]['attempts'])==2 and not history[0]['attempts'][0]['success'] and history[0]['attempts'][1]['success']
    assert 'sk-test' not in json.dumps(history)
    assert c.post('/api/v1/ai/chat',headers=h,json=payload()).status_code==200;assert used[-1]=='sk-test-good'
    assert c.post('/admin/api/assistant/apis/'+bad['id']+'/reset',headers=csrf,json={}).status_code==200
    assert next(x for x in c.get('/admin/api/assistant/apis').json()['apis'] if x['id']==bad['id'])['cooldownUntil']==0

def test_all_fail_refund_and_safety_rejection_does_not_route_around_review(client,monkeypatch):
    c=client;uid,h=account(c);csrf=admin(c);add(c,csrf,'a');add(c,csrf,'b');enabled(c,csrf)
    used=[]
    def fake(*args):used.append(1);raise error(401)
    monkeypatch.setattr(a,'provider_call',fake)
    assert c.post('/api/v1/ai/chat',headers=h,json=payload()).status_code==502
    assert balance(c,h)==100 and len(used)==2
    for row in c.get('/admin/api/assistant/apis').json()['apis']:c.post('/admin/api/assistant/apis/'+row['id']+'/reset',headers=csrf,json={})
    used.clear()
    def rejected(*args):
        used.append(1);raise urllib.error.HTTPError('https://official.invalid/',400,'hidden',None,io.BytesIO(b'{"error":{"code":"DataInspectionFailed"}}'))
    monkeypatch.setattr(a,'provider_call',rejected)
    assert c.post('/api/v1/ai/chat',headers=h,json=payload()).status_code==502
    assert len(used)==1 and balance(c,h)==100

def test_image_capability_and_record_retained_when_key_deleted(client,monkeypatch):
    c=client;uid,h=account(c);csrf=admin(c);add(c,csrf,'text',supportsImages=False);picture=add(c,csrf,'vision','qwen');enabled(c,csrf);used=[]
    def fake(key,*args):used.append(key);return response()
    monkeypatch.setattr(a,'provider_call',fake)
    body=payload(messages=[{'role':'user','content':[{'type':'text','text':'private-photo-prompt'},{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,YQ=='}}]}])
    assert c.post('/api/v1/ai/chat',headers=h,json=body).status_code==200;assert used==['sk-test-vision']
    assert c.delete('/admin/api/assistant/apis/'+picture['id'],headers=csrf).status_code==200
    log=c.get('/admin/api/assistant/usage').json()['calls'][0];assert log['attempts'][0]['name']=='vision'
    assert 'private-photo-prompt' not in json.dumps(log)
    assert c.post('/api/v1/ai/chat',headers=h,json={**body,'requestId':secrets.token_hex(16)}).status_code==502
    assert len(used)==1 and balance(c,h)==98

def test_legacy_key_migrates_once_without_changing_rates(client):
    c=client;secret=a.cipher().encrypt(b'sk-legacy-only').decode()
    with Session(m.engine) as s:
        s.delete(s.get(a.BillingRules,'default'))
        s.add(a.Config(id='default',secret=secret,rules={**a.Rules(multiplier='7',enabled=True).model_dump(),'model':'deepseek-flash'}));s.commit()
    a.initialize();a.initialize()
    with Session(m.engine) as s:
        assert s.get(a.Config,'default').secret==''
        assert s.scalar(select(func.count()).select_from(a.Endpoint))==1
        assert s.get(a.Endpoint,'legacy-default').secret==secret
        assert s.get(a.BillingRules,'default').rules['multiplier']=='7'

def test_adapter_fields_fixed_official_urls_and_cached_usage():
    ds=SimpleNamespace(provider='deepseek',model='deepseek-flash',maxTokens=100)
    qw=SimpleNamespace(provider='qwen',model='qwen3-vl-plus',maxTokens=100)
    assert a.provider_payload(ds,[])['thinking']=={'type':'disabled'}
    assert a.provider_payload(qw,[])['enable_thinking'] is False and 'thinking' not in a.provider_payload(qw,[])
    assert a.provider_url('qwen','cn')=='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    assert a.provider_url('qwen','intl')=='https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
    with pytest.raises(ValueError):a.provider_url('other','cn')
    assert a.price({'prompt_tokens':1000,'completion_tokens':100,'cached_tokens':200},a.Rules(),'peak')[0]==2

def test_relay_preserves_raw_reply_and_client_messages(client,monkeypatch):
    c=client;uid,h=account(c);csrf=admin(c);add(c,csrf,'relay');enabled(c,csrf)
    messages=[{'role':'system','content':'client-owned protocol'},{'role':'user','content':'please plan'}]
    raw='```json\n{"message":"客户端校验此建议","operations":[{"type":"client.future.operation"}]}\n```'
    def fake(key,settings,actual):
        assert actual==messages
        d=response();d['choices'][0]['message']['content']=raw;return d
    monkeypatch.setattr(a,'provider_call',fake)
    r=c.post('/api/v1/ai/chat',headers=h,json=payload(messages=messages))
    assert r.status_code==200 and r.json()['choices'][0]['message']['content']==raw
    with Session(m.engine) as s:assert s.get(m.User,uid).revision==0

def test_large_output_configuration_and_sticky_conversation(client,monkeypatch):
    c=client;uid,h=account(c);csrf=admin(c);add(c,csrf,'one');add(c,csrf,'two','qwen',model='qwen3.8-flash');enabled(c,csrf)
    r=c.post('/admin/api/assistant/rules',headers=csrf,json={'enabled':True,'period':'peak','maxTokens':131072});assert r.status_code==200
    assert c.post('/admin/api/assistant/rules',headers=csrf,json={'maxTokens':131073}).status_code==422
    used=[]
    def fake(key,settings,messages):
        used.append(key);assert settings.maxTokens==131072
        return response()
    monkeypatch.setattr(a,'provider_call',fake);conversation=secrets.token_hex(16)
    for _ in range(2):assert c.post('/api/v1/ai/chat',headers=h,json=payload(conversationId=conversation)).status_code==200
    assert used[0]==used[1]
    with Session(m.engine) as s:
        row=s.scalar(select(a.Endpoint).where(a.Endpoint.secret!='').order_by(a.Endpoint.id))
        selected=next(r for r in s.scalars(select(a.Endpoint)) if a.cipher().decrypt(r.secret.encode()).decode()==used[0])
        selected.enabled=False;s.commit()
    assert c.post('/api/v1/ai/chat',headers=h,json=payload(conversationId=conversation)).status_code==200
    assert used[-1]!=used[0]
    assert a.model_output_limit('qwen3-vl-plus')==32768
    assert a.model_output_limit('qwen3.7-plus')==65536

def test_ten_image_context_and_long_text_stay_valid():
    messages=[{'role':'system','content':'x'*150000},{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/png;base64,YQ=='}}]*10},{'role':'assistant','content':'{"message":"补充时间","operations":[]}'},{'role':'user','content':'明天中午12点'}]
    a.validate_messages(messages)

def test_hundred_thousand_output_can_settle_when_budget_allows(client,monkeypatch):
    c=client;uid,h=account(c,coins=1000);csrf=admin(c);setup(c,csrf,maxTokens=131072,maxCharge=1000)
    raw=json.dumps({'message':'x'*131072,'operations':[]})
    def fake(key,settings,messages):
        assert settings.maxTokens==131072
        out=response(out=131072);out['choices'][0]['message']['content']=raw;return out
    monkeypatch.setattr(a,'provider_call',fake)
    r=c.post('/api/v1/ai/chat',headers=h,json=payload());assert r.status_code==200,r.text
    assert r.json()['choices'][0]['message']['content']==raw
    expected=a.price(response(out=131072)['usage'],a.Rules(),'peak')[0]
    assert r.json()['billing']['coins']==expected and balance(c,h)==1000-expected
