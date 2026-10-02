"""Run inside API container. All writes stay in a new disposable schema, never user tables."""
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import secrets
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from fastapi import HTTPException
from . import main
from .schema import Registration, Invite, Decision, PutData, Refresh


def verify():
    original = main.engine
    if original.dialect.name != "postgresql":
        raise RuntimeError("PostgreSQL required")
    schema = "qa_" + secrets.token_hex(8)
    with original.begin() as conn:
        conn.execute(text('CREATE SCHEMA "' + schema + '"'))
    isolated = create_engine(main.URL, connect_args={"options": "-csearch_path=" + schema})
    main.engine = isolated
    try:
        main.Base.metadata.create_all(isolated)
        users = []
        for name in ("alice", "bob", "charlie"):
            with Session(isolated) as session:
                users.append(main.register(Registration(username=name, password="qa-password-2026", nickname=name), session))
        a, b, c = users
        def token(user): return SimpleNamespace(user_id=user["user"]["userId"])
        invitations = []
        for sender in (a, c):
            with Session(isolated) as session:
                invitations.append(main.invite(Invite(userId=b["user"]["userId"]), token(sender), session))
        def accept(invitation):
            with Session(isolated) as session:
                try:
                    main.decide(invitation["id"], Decision(action="accept"), token(b), session)
                    return 200
                except HTTPException as e: return e.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(accept, invitations)) == [200, 409]
        doc = {"version": 2, "slots": [{"id": "s", "start": "08:00", "end": "08:45"}], "courses": [], "todos": []}
        def put(_):
            with Session(isolated) as session:
                try:
                    main.put_data(PutData(baseRevision=0, document=doc), token(a), session)
                    return 200
                except HTTPException as e: return e.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(put, range(2))) == [200, 409]
        def refresh(_):
            with Session(isolated) as session:
                try:
                    main.refresh(Refresh(refreshToken=a["refreshToken"]), session)
                    return 200
                except HTTPException as e: return e.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(refresh, range(2))) == [200, 401]
        print("PASS PostgreSQL: concurrent acceptance, revision CAS, refresh token rotation")
    finally:
        main.engine = original
        isolated.dispose()
        with original.begin() as conn:
            conn.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))


if __name__ == "__main__":
    verify()
