"""Private operator portal; administrator identities are separate from app users."""
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import Column, String, BigInteger, select, delete, or_
from sqlalchemy.orm import Session
from argon2.exceptions import VerificationError
from . import main as m

router = APIRouter(prefix='/admin')

class Admin(m.Base):
    __tablename__ = 'admins'
    username = Column(String(32), primary_key=True)
    password_hash = Column(String(256), nullable=False)

class AdminSession(m.Base):
    __tablename__ = 'admin_sessions'
    token_hash = Column(String(64), primary_key=True)
    username = Column(String(32), nullable=False)
    csrf = Column(String(64), nullable=False)
    expiry = Column(BigInteger, nullable=False)

class Audit(m.Base):
    __tablename__ = 'admin_audit'
    id = Column(String(32), primary_key=True)
    admin = Column(String(32), nullable=False)
    user_id = Column(String(12), nullable=False)
    action = Column(String(32), nullable=False)
    created_at = Column(BigInteger, nullable=False)

class Login(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)

class Reset(BaseModel):
    password: str = Field(min_length=10, max_length=128)

def authorized(request: Request, session: Session = Depends(m.db)):
    token = request.cookies.get('orbit_admin', '')
    auth = session.get(AdminSession, m.digest(token)) if token else None
    if not auth or auth.expiry < time.time():
        raise HTTPException(401, '请先登录管理员账号')
    if request.method not in ('GET', 'HEAD'):
        if not secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), auth.csrf):
            raise HTTPException(403, '会话校验失败，请重新登录')
    return auth

@router.get('/', include_in_schema=False)
def page():
    return FileResponse(Path(__file__).parent/'admin-web'/'index.html', headers={'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"})

@router.get('/app.js', include_in_schema=False)
def script():
    return FileResponse(Path(__file__).parent/'admin-web'/'app.js', media_type='application/javascript')

@router.post('/api/login')
def login(data: Login, response: Response, session: Session = Depends(m.db)):
    m.throttle(('admin-login', data.username.lower()), 8, 300)
    user = session.get(Admin, data.username.lower())
    try:
        m.password_work(m.passwords.verify, user.password_hash if user else m.DUMMY_HASH, data.password)
    except VerificationError:
        raise HTTPException(401, '账号或密码错误')
    if not user:
        raise HTTPException(401, '账号或密码错误')
    token, csrf = secrets.token_urlsafe(48), secrets.token_hex(32)
    session.execute(delete(AdminSession).where(AdminSession.expiry < int(time.time())))
    session.add(AdminSession(token_hash=m.digest(token), username=user.username, csrf=csrf, expiry=int(time.time())+3600))
    session.commit()
    response.set_cookie('orbit_admin', token, max_age=3600, secure=True, httponly=True, samesite='strict', path='/admin')
    return {'username': user.username, 'csrf': csrf}

@router.get('/api/session')
def current(auth=Depends(authorized)):
    return {'username': auth.username, 'csrf': auth.csrf}

@router.post('/api/logout')
def logout(response: Response, auth=Depends(authorized), session: Session=Depends(m.db)):
    session.delete(auth); session.commit()
    response.delete_cookie('orbit_admin', path='/admin', secure=True, httponly=True, samesite='strict')
    return {'ok': True}

@router.get('/api/users')
def users(q: str='', offset: int=0, auth=Depends(authorized), session: Session=Depends(m.db)):
    if len(q)>80 or offset<0 or offset>100000:
        raise HTTPException(422, '查询参数无效')
    term=q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
    pattern='%'+term+'%'
    rows=session.scalars(select(m.User).where(or_(m.User.username.ilike(pattern, escape='\\'),m.User.nickname.ilike(pattern, escape='\\'),m.User.id.ilike(pattern, escape='\\'))).order_by(m.User.username).offset(offset).limit(51)).all()
    return {'users':[{'userId':u.id,'username':u.username,'nickname':u.nickname,'partnerId':u.partner_id} for u in rows[:50]],'hasMore':len(rows)>50}

@router.post('/api/users/{user_id}/password')
def reset(user_id: str, data: Reset, auth=Depends(authorized), session: Session=Depends(m.db)):
    m.throttle(('admin-reset',auth.username),20,300)
    user=session.scalar(select(m.User).where(m.User.id==user_id).with_for_update())
    if not user: raise HTTPException(404,'用户不存在')
    user.password_hash=m.password_work(m.passwords.hash,data.password)
    session.execute(delete(m.Token).where(m.Token.user_id==user.id))
    session.add(Audit(id=secrets.token_hex(16),admin=auth.username,user_id=user.id,action='password_reset',created_at=int(time.time())))
    session.commit()
    return {'ok':True}
