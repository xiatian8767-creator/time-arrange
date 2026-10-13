"""Scheduled, account-targeted H5 campaigns and account-wide display receipts."""
import ipaddress
import secrets
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import Field, model_validator
from sqlalchemy import Column, String, Integer, BigInteger, Boolean, JSON, ForeignKey, select, delete
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from . import main as m
from .admin import authorized, Audit
from .schema import Strict

router = APIRouter()
CHINA = timezone(timedelta(hours=8))

@router.get('/updates/2.1beta/', include_in_schema=False)
@router.get('/updates/3.2beta.1/', include_in_schema=False)
@router.get('/updates/3.2beta.2/', include_in_schema=False)
@router.get('/updates/3.2beta.3/', include_in_schema=False)
def update_page():
    raise HTTPException(410, '此升级页面已下线')

@router.get('/updates/security/', include_in_schema=False)
def security_page():
    return FileResponse(Path(__file__).parent/'updates'/'security.html', headers={'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"})

class Campaign(m.Base):
    __tablename__ = 'app_campaigns'
    id = Column(String(32), primary_key=True)
    title = Column(String(80), nullable=False)
    url = Column(String(2000), nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    audience = Column(String(12), nullable=False)
    user_ids = Column(JSON, nullable=False)
    starts_at = Column(BigInteger, nullable=False)
    frequency = Column(String(10), nullable=False)
    enabled = Column(Boolean, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    created_at = Column(BigInteger, nullable=False)

class Receipt(m.Base):
    __tablename__ = 'campaign_receipts'
    campaign_id = Column(String(32), ForeignKey('app_campaigns.id'), primary_key=True)
    user_id = Column(String(12), ForeignKey('users.id'), primary_key=True)
    period = Column(String(30), primary_key=True)
    displayed_at = Column(BigInteger, nullable=False)

class Config(Strict):
    title: str = Field(min_length=1, max_length=80)
    url: str = Field(max_length=2000)
    width: int = Field(ge=60, le=96)
    height: int = Field(ge=30, le=90)
    audience: str = Field(pattern='^(all|custom)$')
    userIds: list[str] = Field(default_factory=list, max_length=2000)
    startsAt: int = Field(ge=0, le=4102444800000)
    frequency: str = Field(pattern='^(once|daily|weekly)$')
    enabled: bool = True
    revision: int = Field(default=0, ge=0)

    @model_validator(mode='after')
    def valid(self):
        url = urlsplit(self.url)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.port not in (None, 80, 443, 8080, 8443):
            raise ValueError('HTTP or HTTPS public URL required')
        host = url.hostname.lower()
        if host in ('localhost', 'appassets.androidplatform.net') or '.' not in host or host.endswith(('.local', '.internal')):
            raise ValueError('public URL required')
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError('public URL required')
        self.title = self.title.strip()
        if not self.title or (self.audience == 'custom' and not self.userIds):
            raise ValueError('title and audience required')
        if len(self.userIds) != len(set(self.userIds)) or any(len(x) != 12 or any(c not in '0123456789abcdef' for c in x) for x in self.userIds):
            raise ValueError('invalid user IDs')
        return self

def info(row):
    return {'id': row.id, 'title': row.title, 'url': row.url, 'width': row.width, 'height': row.height, 'audience': row.audience, 'userIds': row.user_ids, 'startsAt': row.starts_at, 'frequency': row.frequency, 'enabled': row.enabled, 'revision': row.revision}

def period(row, now):
    date = datetime.fromtimestamp(now / 1000, CHINA)
    if row.frequency == 'once': return 'once'
    if row.frequency == 'daily': return 'd:' + date.strftime('%Y-%m-%d')
    iso = date.isocalendar()
    return f'w:{iso.year}-{iso.week:02}'

def eligible(row, user_id, now):
    return row.enabled and row.starts_at <= now and (row.audience == 'all' or user_id in row.user_ids)

@router.get('/admin/campaigns.js', include_in_schema=False)
def script():
    return FileResponse(Path(__file__).parent/'admin-web'/'campaigns.js', media_type='application/javascript')

@router.get('/admin/api/campaigns')
def listing(auth=Depends(authorized), session: Session=Depends(m.db)):
    return {'campaigns': [info(r) for r in session.scalars(select(Campaign).order_by(Campaign.created_at.desc())).all()]}

@router.post('/admin/api/campaigns')
@router.post('/admin/api/campaigns/{campaign_id}')
def save(data: Config, campaign_id: str='', auth=Depends(authorized), session: Session=Depends(m.db)):
    if data.audience == 'custom':
        found = set(session.scalars(select(m.User.id).where(m.User.id.in_(data.userIds))).all())
        if len(found) != len(data.userIds): raise HTTPException(422, '部分用户 ID 不存在，请核对')
    row = session.scalar(select(Campaign).where(Campaign.id == campaign_id).with_for_update()) if campaign_id else None
    if campaign_id and not row: raise HTTPException(404, '弹窗不存在')
    if row and row.revision != data.revision: raise HTTPException(409, '配置已更新，请刷新后再编辑')
    if row is None:
        row = Campaign(id=secrets.token_hex(16), created_at=int(time.time()*1000), revision=0)
        session.add(row)
    row.title, row.url, row.width, row.height = data.title, data.url, data.width, data.height
    row.audience, row.user_ids, row.starts_at = data.audience, data.userIds if data.audience == 'custom' else [], data.startsAt
    row.frequency, row.enabled, row.revision = data.frequency, data.enabled, row.revision+1
    session.add(Audit(id=secrets.token_hex(16), admin=auth.username, user_id='', action='campaign_save', created_at=int(time.time())))
    session.commit()
    return info(row)

class DeleteCampaign(Strict):
    revision: int = Field(ge=1)

@router.post('/admin/api/campaigns/{campaign_id}/delete')
def remove(campaign_id: str, data: DeleteCampaign, auth=Depends(authorized), session: Session=Depends(m.db)):
    row = session.scalar(select(Campaign).where(Campaign.id == campaign_id).with_for_update())
    if not row: raise HTTPException(404, '弹窗不存在')
    if row.revision != data.revision: raise HTTPException(409, '配置已更新，请刷新后再删除')
    session.execute(delete(Receipt).where(Receipt.campaign_id == campaign_id))
    session.delete(row)
    session.add(Audit(id=secrets.token_hex(16), admin=auth.username, user_id='', action='campaign_delete', created_at=int(time.time())))
    session.commit()
    return {'ok': True}

@router.get('/api/v1/campaigns')
def pending(skip: str=Query(default='', max_length=6600), token=Depends(m.authenticated), session: Session=Depends(m.db)):
    now = int(time.time()*1000)
    skipped=set(skip.split(','))
    for row in session.scalars(select(Campaign).where(Campaign.enabled == True, Campaign.starts_at <= now).order_by(Campaign.starts_at.desc(), Campaign.id)).all():
        key = period(row, now)
        if row.id not in skipped and eligible(row, token.user_id, now) and not session.get(Receipt, (row.id, token.user_id, key)):
            return {'campaign': {k:v for k,v in info(row).items() if k not in ('userIds', 'audience')}, 'period': key}
    return {'campaign': None}

@router.post('/api/v1/campaigns/{campaign_id}/displayed')
def displayed(campaign_id: str, token=Depends(m.authenticated), session: Session=Depends(m.db)):
    now = int(time.time()*1000)
    row = session.get(Campaign, campaign_id)
    if not row or not eligible(row, token.user_id, now): raise HTTPException(404, '弹窗已停止或不适用于当前账号')
    key = period(row, now)
    session.add(Receipt(campaign_id=row.id, user_id=token.user_id, period=key, displayed_at=now))
    try: session.commit()
    except IntegrityError: session.rollback()
    return {'ok': True, 'period': key}
