import time

import pytest

from backend.integrations import bootmod3


def get_auth_headers(client):
    client.post("/register", json={"username": "bm3user", "email": "bm3user@example.com", "password": "testpassword"})
    res = client.post("/token", data={"username": "bm3user", "password": "testpassword"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _fake_tokens(exp_offset=3600):
    return {
        "access_token": "jwe.access.token",
        "id_token": "hs256.id.token",
        "token_type": "Bearer",
        "expires_in": 7200,
        "exp": int(time.time()) + exp_offset,
        "email": "driver@example.com",
    }


def test_link_status_import_flow(client, monkeypatch):
    headers = get_auth_headers(client)

    async def fake_auth(username, password, **kw):
        assert (username, password) == ("driver@example.com", "hunter2")
        return _fake_tokens()

    async def fake_download(tokens, log_id, **kw):
        assert tokens["id_token"] == "hs256.id.token"
        return b"Time,RPM,Boost\n0,1000,0\n1,2000,10"

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    monkeypatch.setattr(bootmod3, "download_log", fake_download)

    # not linked yet
    assert client.get("/api/bootmod3/status", headers=headers).json() == {"linked": False}

    # link
    res = client.post("/api/bootmod3/link", headers=headers,
                      json={"username": "driver@example.com", "password": "hunter2"})
    assert res.status_code == 200
    assert res.json() == {"linked": True, "email": "driver@example.com"}

    # status reflects link
    status = client.get("/api/bootmod3/status", headers=headers).json()
    assert status["linked"] is True and status["email"] == "driver@example.com"
    assert status["expired"] is False

    # import by id -> becomes a normal datalog
    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "99887"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["duplicate"] is False
    assert data["filename"] == "dlog_99887.csv"

    # it shows up in the regular library
    logs = client.get("/api/logs", headers=headers).json()["logs"]
    assert any(l["name"] == "dlog_99887.csv" for l in logs)

    # re-import same id -> dedup, no second row
    res2 = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "99887"})
    assert res2.json()["duplicate"] is True
    assert len(client.get("/api/logs", headers=headers).json()["logs"]) == 1

    # unlink
    assert client.delete("/api/bootmod3/link", headers=headers).json() == {"linked": False}
    assert client.get("/api/bootmod3/status", headers=headers).json() == {"linked": False}


def test_link_bad_credentials(client, monkeypatch):
    headers = get_auth_headers(client)

    async def fake_auth(username, password, **kw):
        raise bootmod3.Bootmod3Error("invalid bootmod3 credentials", auth=True)

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    res = client.post("/api/bootmod3/link", headers=headers,
                      json={"username": "x", "password": "y"})
    assert res.status_code == 401


def test_import_requires_link(client):
    headers = get_auth_headers(client)
    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "1"})
    assert res.status_code == 409


def test_import_expired_link(client, monkeypatch):
    headers = get_auth_headers(client)

    async def fake_auth(username, password, **kw):
        return _fake_tokens(exp_offset=-10)  # already expired

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    client.post("/api/bootmod3/link", headers=headers,
                json={"username": "a", "password": "b"})

    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "1"})
    assert res.status_code == 401
    assert "re-link" in res.json()["detail"]
