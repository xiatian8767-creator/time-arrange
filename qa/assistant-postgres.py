"""Run ONLY inside the deployed API container; uses a new isolated test DB."""
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from sqlalchemy import create_engine, text, select, func
from sqlalchemy.orm import Session
from fastapi import HTTPException
from backend import main as m
from backend import assistant as a
from backend.stars import Wallet, Transaction, change, lock_users

production=m.engine
name='star_test_ai_'+secrets.token_hex(5)
assert name.startswith('star_test_ai_') and production.url.get_backend_name()=='postgresql'
admin=create_engine(production.url,isolation_level='AUTOCOMMIT')
with admin.connect() as conn:conn.execute(text('CREATE DATABASE '+name))
isolated=create_engine(production.url.set(database=name),pool_pre_ping=True)
m.engine=isolated
try:
    m.Base.metadata.create_all(isolated)
    user='abcdef123456'
    with Session(isolated) as s:
        s.add(m.User(id=user,username='isolated_ai_test',password_hash='unused-test-only',nickname='isolated',revision=0))
        s.flush();s.add(Wallet(user_id=user,balance=100));s.add(a.Config(id='default',secret=a.cipher().encrypt(b'sk-fake-test-only').decode(),rules=a.Rules(enabled=True,period='peak').model_dump()));s.commit()
    entered=threading.Event();release=threading.Event();calls=[]
    original=a.provider_call
    def fake(*args):
        calls.append(1);entered.set();assert release.wait(10)
        return {'choices':[{'finish_reason':'stop','message':{'content':'{"message":"test","operations":[]}'}}],'usage':{'prompt_tokens':1,'completion_tokens':1}}
    a.provider_call=fake
    body=a.Chat(requestId=secrets.token_hex(16),messages=[{'role':'user','content':'isolated test'}]);token=SimpleNamespace(user_id=user)
    def run():
        with Session(isolated) as s:return a.chat(body,token,s)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future=pool.submit(run);assert entered.wait(10)
        with Session(isolated) as s:
            try:a.chat(body,token,s)
            except HTTPException as error:assert error.status_code==409
            else:raise AssertionError('duplicate request accepted')
        with Session(isolated) as s:
            lock_users(s,[user])
            try:change(s,user,-1,'test-concurrent-spend','gift_out')
            except HTTPException as error:assert error.status_code==409
            else:raise AssertionError('reserved funds double spent')
            s.rollback()
        release.set();result=future.result(10)
    with Session(isolated) as s:
        assert a.chat(body,token,s)==result
        assert s.get(Wallet,user).balance==99
        assert s.scalar(select(func.count()).select_from(Transaction))==1
        assert len(calls)==1
    print('PASS: isolated PostgreSQL concurrent duplicate, reserved-balance double-spend prevention, settlement and idempotent replay')
finally:
    m.engine=production;isolated.dispose()
    with admin.connect() as conn:conn.execute(text('DROP DATABASE '+name+' WITH (FORCE)'))
    admin.dispose()
