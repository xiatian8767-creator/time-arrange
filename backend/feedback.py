"""Anonymous feedback intake; only authenticated operators can read submissions."""
import base64
import io
import ipaddress
import secrets
import time
from pathlib import Path
from typing import Literal
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import Column, String, Text, Integer, BigInteger, JSON, CheckConstraint, select, func
from sqlalchemy.orm import Session, defer
from sqlalchemy.exc import IntegrityError
from . import main as m
from .admin import authorized, Audit

router = APIRouter(prefix='/feedback')
admin_router = APIRouter(prefix='/admin/api/feedback')
STATES = ('pending', 'processing', 'completed')
ASSETS = Path(__file__).parent/'feedback-web'

class Feedback(m.Base):
    __tablename__ = 'user_feedback'
    __table_args__ = (CheckConstraint("status IN ('pending','processing','completed')", name='feedback_status'),)
    id = Column(String(12), primary_key=True)
    request_id = Column(String(32), unique=True, nullable=False)
    description = Column(Text, nullable=False)
    contact = Column(String(200), nullable=False)
    images = Column(JSON, nullable=False)
    image_count = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default='pending', index=True)
    created_at = Column(BigInteger, nullable=False, index=True)
    updated_at = Column(BigInteger, nullable=False)
    handler = Column(String(32), nullable=True)
    note = Column(Text, nullable=False, default='')
    revision = Column(Integer, nullable=False, default=1)

class Submission(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requestId: str = Field(pattern=r'^[a-f0-9]{32}$')
    description: str = Field(min_length=1, max_length=4000)
    contact: str = Field(min_length=1, max_length=200)
    images: list[str] = Field(default_factory=list, max_length=3)
    website: str = Field(default='', max_length=200)  # hidden spam trap

class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['pending', 'processing', 'completed']
    note: str = Field(default='', max_length=2000)
    revision: int = Field(ge=1)

def normalized_image(value):
    try:
        if not value.startswith('data:image/jpeg;base64,') or len(value)>250000:
            raise ValueError()
        raw=base64.b64decode(value.split(',',1)[1], validate=True)
        if len(raw)>180*1024: raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format!='JPEG' or image.width*image.height>4000000: raise ValueError()
            image.load()
            image=ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((1600,1600))
            out=io.BytesIO();image.save(out,format='JPEG',quality=85,optimize=True)
        return base64.b64encode(out.getvalue()).decode('ascii')
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
        raise HTTPException(422,'图片无法读取，请重新选择图片')

def peer(request):
    # Only trust a proxy-provided address when the direct peer is private/local.
    address=request.client.host if request.client else 'unknown'
    try:
        if ipaddress.ip_address(address).is_private:
            forwarded=request.headers.get('x-real-ip','')
            if forwarded: address=str(ipaddress.ip_address(forwarded))
    except ValueError: pass
    return address

@router.get('/', include_in_schema=False)
def page():
    return FileResponse(ASSETS/'index.html',headers={'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"})

@router.get('/app.js', include_in_schema=False)
def script(): return FileResponse(ASSETS/'app.js',media_type='application/javascript')

@router.get('/style.css', include_in_schema=False)
def style(): return FileResponse(ASSETS/'style.css',media_type='text/css')

@router.post('/api',status_code=201)
def submit(data: Submission, request: Request, session: Session=Depends(m.db)):
    origin=request.headers.get('origin')
    if origin and origin!='https://'+request.headers.get('host',''):
        raise HTTPException(403,'请从反馈页面提交')
    description,contact=data.description.strip(),data.contact.strip()
    if not description or not contact or data.website:
        raise HTTPException(422,'请填写问题描述和联系方式')
    previous=session.scalar(select(Feedback).where(Feedback.request_id==data.requestId))
    if previous:
        if previous.description!=description or previous.contact!=contact:
            raise HTTPException(409,'提交内容已变化，请刷新后重试')
        return {'feedbackId':previous.id,'status':'pending'}
    m.throttle(('feedback',peer(request)),5,600)
    images=[normalized_image(value) for value in data.images]
    now=int(time.time()*1000)
    row=Feedback(id=secrets.token_hex(6),request_id=data.requestId,description=description,contact=contact,images=images,image_count=len(images),created_at=now,updated_at=now)
    session.add(row)
    try: session.commit()
    except IntegrityError:
        session.rollback()
        previous=session.scalar(select(Feedback).where(Feedback.request_id==data.requestId))
        if not previous or previous.description!=description or previous.contact!=contact:
            raise HTTPException(409,'提交冲突，请刷新后重试')
        return {'feedbackId':previous.id,'status':'pending'}
    return {'feedbackId':row.id,'status':'pending'}

def info(row):
    return {'id':row.id,'description':row.description,'contact':row.contact,'imageCount':row.image_count,'status':row.status,'createdAt':row.created_at,'updatedAt':row.updated_at,'handler':row.handler,'note':row.note,'revision':row.revision}

@admin_router.get('')
def listing(status: str='',offset: int=0,auth=Depends(authorized),session: Session=Depends(m.db)):
    if status and status not in STATES or offset<0 or offset>100000:
        raise HTTPException(422,'筛选参数无效')
    query=select(Feedback).options(defer(Feedback.images)).order_by(Feedback.created_at.desc(),Feedback.id)
    if status: query=query.where(Feedback.status==status)
    rows=session.scalars(query.offset(offset).limit(31)).all()
    counts={key:0 for key in STATES}
    counts.update(dict(session.execute(select(Feedback.status,func.count()).group_by(Feedback.status)).all()))
    return {'feedback':[info(row) for row in rows[:30]],'hasMore':len(rows)>30,'counts':counts}

@admin_router.get('/{feedback_id}')
def detail(feedback_id: str,auth=Depends(authorized),session: Session=Depends(m.db)):
    row=session.get(Feedback,feedback_id)
    if not row: raise HTTPException(404,'反馈不存在')
    return info(row)

@admin_router.get('/{feedback_id}/images/{index}')
def image(feedback_id: str,index: int,auth=Depends(authorized),session: Session=Depends(m.db)):
    row=session.get(Feedback,feedback_id)
    if not row or index<0 or index>=row.image_count: raise HTTPException(404,'图片不存在')
    return Response(base64.b64decode(row.images[index]),media_type='image/jpeg',headers={'Cache-Control':'no-store','Content-Disposition':'inline; filename="feedback.jpg"'})

@admin_router.post('/{feedback_id}')
def update(feedback_id: str,data: Decision,auth=Depends(authorized),session: Session=Depends(m.db)):
    row=session.scalar(select(Feedback).where(Feedback.id==feedback_id).with_for_update())
    if not row: raise HTTPException(404,'反馈不存在')
    if row.revision!=data.revision: raise HTTPException(409,'反馈已被更新，请重新打开详情')
    row.status=data.status;row.note=data.note.strip();row.handler=auth.username
    row.updated_at=int(time.time()*1000);row.revision+=1
    session.add(Audit(id=secrets.token_hex(16),admin=auth.username,user_id=row.id,action='feedback_'+data.status,created_at=int(time.time())))
    session.commit()
    return info(row)
