"""One-off confirmed 3.4beta.2 limits upgrade; no secret/rate/wallet changes."""
import sys,time
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend import main as m
from backend import assistant as a
from backend.admin import Audit

assert '--apply' in sys.argv,'Pass --apply only after backing up the database'
with Session(m.engine) as s:
    row=s.scalar(select(a.BillingRules).where(a.BillingRules.id=='default').with_for_update())
    assert row and row.rules.get('maxTokens',8192) in (8192,131072),'Output configuration changed; review before upgrading'
    before=dict(row.rules);updated={**before,'maxTokens':131072}
    a.Rules.model_validate(updated);row.rules=updated
    changed=0
    for api in s.scalars(select(a.Endpoint).with_for_update()):
        if api.timeout<180:api.timeout=180;api.revision=a.ident();changed+=1
    assert all(row.rules[k]==v for k,v in before.items() if k!='maxTokens')
    if before!=updated or changed:
        s.add(Audit(id=a.ident(),admin='deployment',user_id='',action='assistant_context_upgrade',created_at=int(time.time())))
    s.commit();print(dict(maxTokens=131072,apiTimeoutsExtended=changed,maxCharge=row.rules.get('maxCharge'),ratesAndBalancesUnchanged=True))
