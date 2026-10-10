"""Single-process small private deployment. PostgreSQL is the production store."""
import hashlib
import os
import secrets
import time
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, Column, String, Integer, BigInteger, JSON, ForeignKey, select, update, delete, text, or_
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.exc import IntegrityError
from .schema import Registration, Credentials, Refresh, PutData, Invite, Decision

URL = os.environ.get("DATABASE_URL", "sqlite:///./xingke-dev.db")
engine = create_engine(URL, pool_pre_ping=True, **({"connect_args": {"check_same_thread": False}} if URL.startswith("sqlite") else {}))
passwords = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))
password_slots = threading.BoundedSemaphore(2)


def password_work(action, *args):
    if not password_slots.acquire(blocking=False):
        raise HTTPException(429, "登录繁忙，请稍后重试")
    try:
        return action(*args)
    finally:
        password_slots.release()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id = Column(String(12), primary_key=True)
    username = Column(String(32), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    nickname = Column(String(30), nullable=False)
    document = Column(JSON, nullable=True)
    revision = Column(Integer, default=0, nullable=False)
    partner_id = Column(String(12), ForeignKey("users.id"), unique=True, nullable=True)


class Token(Base):
    __tablename__ = "sessions"
    id = Column(String(64), primary_key=True)
    user_id = Column(String(12), ForeignKey("users.id"), nullable=False, index=True)
    access_hash = Column(String(64), unique=True, nullable=False)
    refresh_hash = Column(String(64), unique=True, nullable=False)
    access_expiry = Column(BigInteger, nullable=False)
    refresh_expiry = Column(BigInteger, nullable=False)


class Invitation(Base):
    __tablename__ = "invitations"
    id = Column(String(32), primary_key=True)
    sender = Column(String(12), ForeignKey("users.id"), nullable=False, index=True)
    recipient = Column(String(12), ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending")
    created_at = Column(BigInteger, nullable=False)


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="星课表 API", version="2.0.0", lifespan=lifespan)
limits = OrderedDict()
limit_lock = threading.Lock()


def throttle(key, maximum, seconds=60):
    now = time.monotonic()
    with limit_lock:
        count, until = limits.get(key, (0, now + seconds))
        if until < now:
            count, until = 0, now + seconds
        if count >= maximum:
            raise HTTPException(429, "请求太频繁，请稍后重试")
        limits[key] = (count + 1, until)
        limits.move_to_end(key)
        while len(limits) > 10000:
            limits.popitem(last=False)


@app.middleware("http")
async def guard(request: Request, call_next):
    try:
        is_auth = "/auth/" in request.url.path or request.url.path == "/admin/api/login"
        throttle((request.client.host, "auth" if is_auth else "general"), 30 if is_auth else 240)
        # Read before JSON parsing; also limits chunked bodies without Content-Length.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 1024 * 1024:
                return JSONResponse({"detail": "请求不能超过 1 MB"}, status_code=413)
        request._body = bytes(body)
        result = await call_next(request)
        result.headers["Cache-Control"] = "no-store"
        result.headers["X-Content-Type-Options"] = "nosniff"
        return result
    except HTTPException as e:
        return JSONResponse({"detail": e.detail}, status_code=e.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # Never echo invalid passwords, document contents or tokens into responses/logs.
    return JSONResponse({"detail": "数据格式不正确，请检查输入或更新客户端"}, status_code=422)


def db():
    with Session(engine) as session:
        yield session


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def authenticated(authorization: str = Header(default=""), session: Session = Depends(db)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "请先登录")
    token = session.scalar(select(Token).where(Token.access_hash == digest(authorization[7:])))
    if not token or token.access_expiry < time.time():
        raise HTTPException(401, "登录已过期")
    return token


def profile(user):
    return {"userId": user.id, "nickname": user.nickname}


def tokens(session, user, token=None):
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    now = int(time.time())
    if token is None:
        session.execute(delete(Token).where(Token.refresh_expiry < now))
        token = Token(id=secrets.token_hex(24), user_id=user.id)
        session.add(token)
    token.access_hash, token.refresh_hash = digest(access), digest(refresh)
    token.access_expiry, token.refresh_expiry = now + 900, now + 30 * 86400
    session.commit()
    return {"accessToken": access, "refreshToken": refresh, "expiresIn": 900, "user": profile(user)}


@app.post("/api/v1/auth/register", status_code=201)
def register(data: Registration, session: Session = Depends(db)):
    if not data.nickname.strip():
        raise HTTPException(422, "昵称不能为空")
    user = User(id=secrets.token_hex(6), username=data.username.lower(), nickname=data.nickname.strip(), password_hash=password_work(passwords.hash, data.password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "用户名已使用")
    return tokens(session, user)


@app.post("/api/v1/auth/login")
def login(data: Credentials, session: Session = Depends(db)):
    throttle(("login", data.username.lower()), 15, 300)
    user = session.scalar(select(User).where(User.username == data.username.lower()).with_for_update())
    try:
        password_work(passwords.verify, user.password_hash if user else DUMMY_HASH, data.password)
    except VerificationError:
        raise HTTPException(401, "账号或密码不正确")
    if not user:
        raise HTTPException(401, "账号或密码不正确")
    return tokens(session, user)


@app.post("/api/v1/auth/refresh")
def refresh(data: Refresh, session: Session = Depends(db)):
    token = session.scalar(select(Token).where(Token.refresh_hash == digest(data.refreshToken)).with_for_update())
    if not token or token.refresh_expiry < time.time():
        raise HTTPException(401, "请重新登录")
    return tokens(session, session.get(User, token.user_id), token)


@app.post("/api/v1/auth/logout")
def logout(token=Depends(authenticated), session: Session = Depends(db)):
    session.delete(token)
    session.commit()
    return {"ok": True}


@app.get("/api/v1/me/data")
def get_data(token=Depends(authenticated), session: Session = Depends(db)):
    user = session.get(User, token.user_id)
    return {"user": profile(user), "revision": user.revision, "document": user.document}


@app.put("/api/v1/me/data")
def put_data(data: PutData, token=Depends(authenticated), session: Session = Depends(db)):
    user = session.scalar(select(User).where(User.id == token.user_id).with_for_update())
    document = data.document.model_dump(exclude_none=True)
    # Older clients do not know alarm fields. Preserve existing alarms only when
    # their task time is unchanged; never opt an old task into ringing.
    previous = {t['id']: t for t in (user.document or {}).get('todos', [])}
    for model, todo in zip(data.document.todos, document['todos']):
        old = previous.get(todo['id'], {})
        if 'alarmEnabled' not in model.model_fields_set and 'alarmAt' not in model.model_fields_set and old.get('dueAt') == todo['dueAt']:
            todo['alarmEnabled'] = old.get('alarmEnabled', False)
            todo['alarmAt'] = old.get('alarmAt', 0)
    result = session.execute(update(User).where(User.id == token.user_id, User.revision == data.baseRevision).values(document=document, revision=User.revision + 1))
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, "云端已有更新，请先处理冲突")
    session.commit()
    return {"revision": data.baseRevision + 1}


@app.get("/api/v1/users/lookup")
def lookup(userId: str, token=Depends(authenticated), session: Session = Depends(db)):
    throttle(("lookup", token.user_id), 20)
    user = session.get(User, userId) if len(userId) == 12 else None
    if not user:
        raise HTTPException(404, "未找到此 ID")
    return profile(user)


def relationship_lock(session):
    # All invitation/binding mutations serialize in PostgreSQL, across workers.
    if engine.dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(2020001)"))


@app.get("/api/v1/partner")
def partner(token=Depends(authenticated), session: Session = Depends(db)):
    relationship_lock(session)
    user = session.get(User, token.user_id)
    mate = session.get(User, user.partner_id) if user.partner_id else None
    invites = session.scalars(select(Invitation).where(or_(Invitation.sender == user.id, Invitation.recipient == user.id), Invitation.status == "pending").order_by(Invitation.created_at.desc())).all()
    def item(i):
        other = session.get(User, i.sender if i.recipient == user.id else i.recipient)
        return {"id": i.id, "user": profile(other), "createdAt": i.created_at * 1000}
    document = mate.document if mate else None
    return {"partner": ({**profile(mate), "revision": mate.revision, "schedule": {"version": 2, "slots": document["slots"], "courses": document["courses"]} if document else None} if mate else None),
            "incoming": [item(i) for i in invites if i.recipient == user.id], "outgoing": [item(i) for i in invites if i.sender == user.id]}


@app.post("/api/v1/partner/invitations")
def invite(data: Invite, token=Depends(authenticated), session: Session = Depends(db)):
    throttle(("invite", token.user_id), 10, 3600)
    relationship_lock(session)
    user, other = session.get(User, token.user_id), session.get(User, data.userId)
    if not other or other.id == user.id:
        raise HTTPException(400, "搭子 ID 无效")
    if user.partner_id or other.partner_id:
        raise HTTPException(409, "其中一方已有搭子，请先解除绑定")
    existing = session.scalar(select(Invitation).where(Invitation.sender == user.id, Invitation.recipient == other.id, Invitation.status == "pending"))
    if existing:
        return {"id": existing.id, "status": existing.status}
    invitation = Invitation(id=secrets.token_hex(16), sender=user.id, recipient=other.id, created_at=int(time.time()), status="pending")
    session.add(invitation)
    session.commit()
    return {"id": invitation.id, "status": invitation.status}


@app.patch("/api/v1/partner/invitations/{invitation_id}")
def decide(invitation_id: str, data: Decision, token=Depends(authenticated), session: Session = Depends(db)):
    relationship_lock(session)
    invitation = session.get(Invitation, invitation_id)
    if not invitation or (invitation.sender if data.action == "withdraw" else invitation.recipient) != token.user_id:
        raise HTTPException(404, "邀请不存在")
    status = {"accept": "accepted", "reject": "rejected", "withdraw": "withdrawn"}[data.action]
    if invitation.status == status:
        return {"ok": True}
    if invitation.status != "pending":
        raise HTTPException(409, "邀请已处理，请刷新")
    a, b = session.get(User, invitation.sender), session.get(User, invitation.recipient)
    if data.action == "accept":
        if a.partner_id or b.partner_id:
            raise HTTPException(409, "其中一方已有搭子")
        a.partner_id, b.partner_id = b.id, a.id
        session.execute(update(Invitation).where(Invitation.status == "pending", or_(Invitation.sender.in_([a.id, b.id]), Invitation.recipient.in_([a.id, b.id]))).values(status="withdrawn"))
    invitation.status = status
    session.commit()
    return {"ok": True}


@app.delete("/api/v1/partner")
def unbind(token=Depends(authenticated), session: Session = Depends(db)):
    relationship_lock(session)
    user = session.get(User, token.user_id)
    if user.partner_id:
        other = session.get(User, user.partner_id)
        user.partner_id = other.partner_id = None
    session.commit()
    return {"ok": True}


@app.get("/api/v1/health")
def health(session: Session = Depends(db)):
    session.execute(text("SELECT 1"))
    return {"ok": True, "version": "2.0.0"}

from .admin import router as admin_router
app.include_router(admin_router)
from .feedback import router as feedback_router, admin_router as feedback_admin_router
app.include_router(feedback_router)
app.include_router(feedback_admin_router)
