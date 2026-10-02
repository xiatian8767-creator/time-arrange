import copy
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from backend import main


@pytest.fixture
def client():
    original = main.engine
    main.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.limits.clear()
    with TestClient(main.app) as client:
        yield client
    main.engine.dispose()
    main.engine = original


def register(client, username):
    result = client.post("/api/v1/auth/register", json={"username": username, "password": "test-password-2026", "nickname": username})
    assert result.status_code == 201, result.text
    data = result.json()
    return data, {"Authorization": "Bearer " + data["accessToken"]}


def document():
    return {"version": 2, "slots": [{"id": "s1", "start": "08:00", "end": "08:45"}],
            "courses": [{"id": "c1", "day": 1, "start": "s1", "end": "s1", "name": "数学", "room": "101", "note": "", "color": "#6279dd"}],
            "todos": [{"id": "t1", "title": "私人待办 secret", "dueAt": 1800000000000, "createdAt": 1700000000000, "priority": "normal", "note": "private", "completed": False, "remind": True}]}


def test_auth_sync_rotation_and_logout(client):
    a, h = register(client, "alice")
    assert client.get("/api/v1/me/data").status_code == 401
    assert client.get("/api/v1/me/data", headers=h).json()["document"] is None
    assert client.put("/api/v1/me/data", headers=h, json={"baseRevision": 0, "document": document()}).json() == {"revision": 1}
    assert client.put("/api/v1/me/data", headers=h, json={"baseRevision": 0, "document": document()}).status_code == 409
    login = client.post("/api/v1/auth/login", json={"username": "ALICE", "password": "test-password-2026"}).json()
    assert client.get("/api/v1/me/data", headers={"Authorization": "Bearer " + login["accessToken"]}).json()["document"] == document()
    rotated = client.post("/api/v1/auth/refresh", json={"refreshToken": a["refreshToken"]}).json()
    assert client.post("/api/v1/auth/refresh", json={"refreshToken": a["refreshToken"]}).status_code == 401
    assert client.get("/api/v1/me/data", headers=h).status_code == 401
    h = {"Authorization": "Bearer " + rotated["accessToken"]}
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/api/v1/me/data", headers=h).status_code == 401


def test_partner_privacy_authorization_idempotence_unbind(client):
    a, ah = register(client, "alice")
    b, bh = register(client, "bob")
    _, ch = register(client, "charlie")
    client.put("/api/v1/me/data", headers=bh, json={"baseRevision": 0, "document": document()})
    found = client.get("/api/v1/users/lookup", params={"userId": b["user"]["userId"]}, headers=ah).json()
    assert set(found) == {"userId", "nickname"}
    invitation = client.post("/api/v1/partner/invitations", headers=ah, json={"userId": found["userId"]}).json()
    assert client.post("/api/v1/partner/invitations", headers=ah, json={"userId": found["userId"]}).json() == invitation
    path = "/api/v1/partner/invitations/" + invitation["id"]
    assert client.patch(path, headers=ch, json={"action": "accept"}).status_code == 404
    assert client.patch(path, headers=ah, json={"action": "accept"}).status_code == 404
    assert client.patch(path, headers=bh, json={"action": "accept"}).status_code == 200
    assert client.patch(path, headers=bh, json={"action": "accept"}).status_code == 200
    result = client.get("/api/v1/partner", headers=ah)
    assert "secret" not in result.text and "todos" not in result.text and "password" not in result.text
    assert result.json()["partner"]["schedule"]["courses"][0]["name"] == "数学"
    assert client.get("/api/v1/partner", headers=ch).json()["partner"] is None
    assert client.post("/api/v1/partner/invitations", headers=ch, json={"userId": found["userId"]}).status_code == 409
    assert client.delete("/api/v1/partner", headers=ah).status_code == 200
    assert client.get("/api/v1/partner", headers=ah).json()["partner"] is None
    assert client.get("/api/v1/partner", headers=bh).json()["partner"] is None


@pytest.mark.parametrize("mutation", ["overlap", "unknown_field", "bad_time", "bad_id", "boolean_day", "bad_todo"])
def test_invalid_documents(client, mutation):
    _, headers = register(client, "tester")
    doc = document()
    if mutation == "overlap":
        other = copy.deepcopy(doc["courses"][0]);other["id"] = "c2";doc["courses"].append(other)
    elif mutation == "unknown_field": doc["apiKey"] = "must not store"
    elif mutation == "bad_time": doc["slots"][0]["start"] = "29:50"
    elif mutation == "bad_id": doc["courses"][0]["start"] = "missing"
    elif mutation == "boolean_day": doc["courses"][0]["day"] = True
    elif mutation == "bad_todo": doc["todos"][0]["title"] = " "
    assert client.put("/api/v1/me/data", headers=headers, json={"baseRevision": 0, "document": doc}).status_code == 422
    assert client.get("/api/v1/me/data", headers=headers).json()["revision"] == 0


def test_reject_withdraw_and_limits(client):
    _, ah = register(client, "alice")
    b, bh = register(client, "bob")
    for action in ["reject", "withdraw"]:
        invitation = client.post("/api/v1/partner/invitations", headers=ah, json={"userId": b["user"]["userId"]}).json()
        assert client.patch("/api/v1/partner/invitations/" + invitation["id"], headers=bh if action == "reject" else ah, json={"action": action}).status_code == 200
        assert not client.get("/api/v1/partner", headers=ah).json()["outgoing"]
    assert client.post("/api/v1/auth/login", json={"username": "alice", "password": "wrong-password"}).status_code == 401
    assert client.put("/api/v1/me/data", headers=ah, content=b"x" * (1024*1024 + 1)).status_code == 413
    for _ in range(21):
        result = client.get("/api/v1/users/lookup?userId=aaaaaaaaaaaa", headers=ah)
    assert result.status_code == 429
