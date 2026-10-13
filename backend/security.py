"""Account recovery answers are salted hashes, separate from synced documents."""
import time
import unicodedata
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, model_validator
from sqlalchemy import Column, String, Integer, BigInteger, ForeignKey, select, delete
from sqlalchemy.orm import Session
from argon2.exceptions import VerificationError
from . import main as m
from .schema import Strict

router = APIRouter(prefix='/api/v1')
QUESTIONS = {'place': '你记忆深刻的一个地方是？', 'phrase': '你为自己设置的秘密短语是？', 'character': '你喜欢的一个角色是？', 'memory': '你想记住的一件小事是？', 'object': '对你有特别意义的一件物品是？'}

class Recovery(m.Base):
    __tablename__ = 'account_recovery'
    user_id = Column(String(12), ForeignKey('users.id'), primary_key=True)
    question1 = Column(String(30), nullable=True)
    question2 = Column(String(30), nullable=True)
    answer1 = Column(String(256), nullable=True)
    answer2 = Column(String(256), nullable=True)
    failures = Column(Integer, nullable=False, default=0)
    locked_until = Column(BigInteger, nullable=False, default=0)

def state(session, user_id):
    row = session.get(Recovery, user_id)
    return {'configured': bool(row and row.answer1), 'required': bool(row and not row.answer1), 'questions': QUESTIONS}

def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())

class Setup(Strict):
    password: str = Field(min_length=10, max_length=128)
    question1: str = Field(min_length=3, max_length=30)
    question2: str = Field(min_length=3, max_length=30)
    answer1: str = Field(min_length=1, max_length=128)
    answer2: str = Field(min_length=1, max_length=128)

    @model_validator(mode='after')
    def valid(self):
        self.question1 = self.question1.strip()
        self.question2 = self.question2.strip()
        if min(len(self.question1), len(self.question2)) < 3 or any(ord(c) < 32 for c in self.question1 + self.question2):
            raise ValueError('问题需为 3–30 个字符')
        if normalize(QUESTIONS.get(self.question1, self.question1)) == normalize(QUESTIONS.get(self.question2, self.question2)):
            raise ValueError('请设置两个不同的问题')
        if not normalize(self.answer1) or not normalize(self.answer2):
            raise ValueError('答案不能为空')
        return self

class Username(Strict):
    username: str = Field(pattern=r'^[a-zA-Z0-9_]{3,32}$')

class Reset(Username):
    answer1: str = Field(default='', max_length=128)
    answer2: str = Field(default='', max_length=128)
    password: str = Field(min_length=10, max_length=128)

@router.get('/me/security')
def get_security(token=Depends(m.authenticated), session: Session=Depends(m.db)):
    return state(session, token.user_id)

@router.post('/me/security')
def setup(data: Setup, token=Depends(m.authenticated), session: Session=Depends(m.db)):
    m.throttle(('security-setup', token.user_id), 6, 900)
    user = session.scalar(select(m.User).where(m.User.id == token.user_id).with_for_update())
    try:
        m.password_work(m.passwords.verify, user.password_hash, data.password)
    except VerificationError:
        raise HTTPException(400, '当前密码不正确')
    row = session.get(Recovery, user.id)
    if row is None:
        row = Recovery(user_id=user.id)
        session.add(row)
    row.question1, row.question2 = data.question1, data.question2
    row.answer1 = m.password_work(m.passwords.hash, normalize(data.answer1))
    row.answer2 = m.password_work(m.passwords.hash, normalize(data.answer2))
    row.failures, row.locked_until = 0, 0
    session.commit()
    return {'ok': True}

@router.post('/auth/recovery/questions')
def questions(data: Username, session: Session=Depends(m.db)):
    m.throttle(('recovery-questions', data.username.lower()), 8, 900)
    user = session.scalar(select(m.User).where(m.User.username == data.username.lower()))
    row = session.get(Recovery, user.id) if user else None
    if not row or not row.answer1:
        raise HTTPException(400, '账号不存在或尚未设置保密问题，请核对账号或联系管理员')
    return {'questions': [QUESTIONS.get(row.question1, row.question1), QUESTIONS.get(row.question2, row.question2)]}

@router.post('/auth/recovery/reset')
def reset(data: Reset, session: Session=Depends(m.db)):
    m.throttle(('recovery-reset', data.username.lower()), 5, 900)
    user = session.scalar(select(m.User).where(m.User.username == data.username.lower()).with_for_update())
    row = session.get(Recovery, user.id) if user else None
    now = int(time.time())
    if row and row.locked_until > now:
        raise HTTPException(429, '尝试次数过多，请 15 分钟后再试')
    configured = bool(row and row.answer1 and row.answer2)
    valid = False
    for hashed, answer in [(row.answer1 if configured else m.DUMMY_HASH, data.answer1), (row.answer2 if configured else m.DUMMY_HASH, data.answer2)]:
        try:
            m.password_work(m.passwords.verify, hashed, normalize(answer))
            valid = valid or (configured and bool(normalize(answer)))
        except VerificationError:
            pass
    if not valid:
        if row:
            row.failures = (row.failures if row.locked_until == 0 or row.locked_until > now else 0) + 1
            if row.failures >= 5:
                row.locked_until = now + 900
            session.commit()
        raise HTTPException(400, '账号或保密答案不正确')
    user.password_hash = m.password_work(m.passwords.hash, data.password)
    row.failures, row.locked_until = 0, 0
    session.execute(delete(m.Token).where(m.Token.user_id == user.id))
    session.commit()
    return {'ok': True}
