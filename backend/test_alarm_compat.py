from backend.test_api import client, register, document

def test_old_client_alarm_compatibility(client):
    _,h=register(client,'alarm_compat')
    old=document();t=old['todos'][0];del t['alarmEnabled'];del t['alarmAt']
    assert client.put('/api/v1/me/data',headers=h,json={'baseRevision':0,'document':old}).status_code==200
    fresh=client.get('/api/v1/me/data',headers=h).json()['document']
    assert fresh['todos'][0]['alarmEnabled'] is False
    fresh['todos'][0].update(alarmEnabled=True,alarmAt=1799999700000)
    assert client.put('/api/v1/me/data',headers=h,json={'baseRevision':1,'document':fresh}).status_code==200
    old['todos'][0]['title']='older client edit'
    assert client.put('/api/v1/me/data',headers=h,json={'baseRevision':2,'document':old}).status_code==200
    assert client.get('/api/v1/me/data',headers=h).json()['document']['todos'][0]['alarmEnabled'] is True
    old['todos'][0]['dueAt']+=600000
    assert client.put('/api/v1/me/data',headers=h,json={'baseRevision':3,'document':old}).status_code==200
    assert client.get('/api/v1/me/data',headers=h).json()['document']['todos'][0]['alarmEnabled'] is False
    old['todos'][0].update(alarmEnabled=True,alarmAt=0)
    assert client.put('/api/v1/me/data',headers=h,json={'baseRevision':4,'document':old}).status_code==422
