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

    async def fake_list_logs(tokens, **kw):
        return []  # no metadata for this id -> no VIN, no recorded_at

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    monkeypatch.setattr(bootmod3, "download_log", fake_download)
    monkeypatch.setattr(bootmod3, "list_logs", fake_list_logs)

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


# ── bm3 VIN → auto build + recorded_at ───────────────────────────────────────

_BM3_VIN = "WBA3B1C50DK123456"


def _link(client, headers, monkeypatch, *, remote_logs, download=b"Time,RPM,Boost\n0,1000,0\n1,2000,10"):
    async def fake_auth(username, password, **kw):
        return _fake_tokens()

    async def fake_download(tokens, log_id, **kw):
        return download

    async def fake_list_logs(tokens, **kw):
        return remote_logs

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    monkeypatch.setattr(bootmod3, "download_log", fake_download)
    monkeypatch.setattr(bootmod3, "list_logs", fake_list_logs)

    res = client.post("/api/bootmod3/link", headers=headers,
                      json={"username": "driver@example.com", "password": "hunter2"})
    assert res.status_code == 200


def test_bm3_import_vin_creates_and_binds_build(client, db_session, monkeypatch):
    from backend.models import Build
    headers = get_auth_headers(client)
    _link(client, headers, monkeypatch, remote_logs=[
        {"id": "5001", "vin": _BM3_VIN, "date": "2026-06-01T12:00:00Z"},
    ])

    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "5001"})
    assert res.status_code == 200, res.text
    build_id = res.json()["build_id"]
    assert build_id is not None
    build = db_session.get(Build, build_id)
    assert build.vin == _BM3_VIN

    logs = client.get("/api/logs", headers=headers).json()["logs"]
    log = next(l for l in logs if l["name"] == "dlog_5001.csv")
    assert log["recorded_at"].startswith("2026-06-01T12:00:00")
    assert log["build_id"] == build_id


def test_bm3_import_second_log_same_vin_reuses_build(client, db_session, monkeypatch):
    from backend.models import Build
    headers = get_auth_headers(client)
    _link(client, headers, monkeypatch, remote_logs=[
        {"id": "5001", "vin": _BM3_VIN, "date": "2026-06-01T12:00:00Z"},
        {"id": "5002", "vin": _BM3_VIN, "date": "2026-06-02T09:30:00Z"},
    ])

    res1 = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "5001"})
    res2 = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "5002"})
    assert res1.json()["build_id"] == res2.json()["build_id"]
    assert db_session.query(Build).filter(Build.vin == _BM3_VIN).count() == 1


def test_bm3_import_no_vin_no_build_but_still_records_date(client, db_session, monkeypatch):
    from backend.models import Build
    headers = get_auth_headers(client)
    _link(client, headers, monkeypatch, remote_logs=[
        {"id": "5003", "createdAt": "2026-05-15T08:00:00Z"},
    ])

    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "5003"})
    assert res.status_code == 200, res.text
    assert res.json()["build_id"] is None
    assert db_session.query(Build).count() == 0

    logs = client.get("/api/logs", headers=headers).json()["logs"]
    log = next(l for l in logs if l["name"] == "dlog_5003.csv")
    assert log["recorded_at"].startswith("2026-05-15T08:00:00")


def test_bm3_import_metadata_fetch_failure_does_not_block_import(client, monkeypatch):
    headers = get_auth_headers(client)

    async def fake_auth(username, password, **kw):
        return _fake_tokens()

    async def fake_download(tokens, log_id, **kw):
        return b"Time,RPM,Boost\n0,1000,0\n1,2000,10"

    async def fake_list_logs(tokens, **kw):
        raise bootmod3.Bootmod3Error("/getlogs failed (500): boom")

    monkeypatch.setattr(bootmod3, "authenticate", fake_auth)
    monkeypatch.setattr(bootmod3, "download_log", fake_download)
    monkeypatch.setattr(bootmod3, "list_logs", fake_list_logs)
    client.post("/api/bootmod3/link", headers=headers,
                json={"username": "driver@example.com", "password": "hunter2"})

    res = client.post("/api/bootmod3/import", headers=headers, json={"log_id": "9999"})
    assert res.status_code == 200, res.text
    assert res.json()["build_id"] is None


def test_bm3_import_real_getlogs_shape(client, db_session, monkeypatch):
    # Reproduces bootmod3's actual /getlogs entry shape (values below are
    # synthetic, not a real account/vehicle): an object keyed by index rather
    # than a JSON array, vin/createdDate field names, and dates formatted
    # "YYYY-MM-DD HH:MM:SS+0000" (space separator, no colon in the UTC
    # offset) -- none of which are valid input to datetime.fromisoformat.
    from backend.models import Build
    headers = get_auth_headers(client)
    fake_vin = "1FAKE9C50J5K99999"
    fake_log_id = "aaaa1111bbbb2222cccc333"
    _link(client, headers, monkeypatch, remote_logs={
        "0": {
            "id": fake_log_id,
            "userId": "auth0|000000.deadbeefdeadbeefdeadbeef.0000",
            "deviceId": fake_vin,
            "name": "Test-01-0000",
            "vin": fake_vin,
            "mapId": "0000000000000000deadbee",
            "createdDate": "2026-06-10 09:15:30+0000",
            "endedDate": "2026-06-10 09:15:30+0000",
            "duration": 10,
            "lineCount": 0,
        }
    })

    res = client.post("/api/bootmod3/import", headers=headers,
                      json={"log_id": fake_log_id})
    assert res.status_code == 200, res.text
    build_id = res.json()["build_id"]
    assert build_id is not None
    assert db_session.get(Build, build_id).vin == fake_vin

    logs = client.get("/api/logs", headers=headers).json()["logs"]
    log = next(l for l in logs if l["name"] == f"dlog_{fake_log_id}.csv")
    assert log["recorded_at"].startswith("2026-06-10T09:15:30")


def test_bm3_import_explicit_build_id_skips_vin_autocreate(client, db_session, monkeypatch):
    from backend.models import Build, User
    headers = get_auth_headers(client)
    user = db_session.query(User).filter(User.username == "bm3user").one()
    manual_build = Build(user_id=user.id, name="Manual build", status="active")
    db_session.add(manual_build)
    db_session.commit()

    _link(client, headers, monkeypatch, remote_logs=[
        {"id": "5004", "vin": _BM3_VIN, "date": "2026-06-01T12:00:00Z"},
    ])

    res = client.post("/api/bootmod3/import", headers=headers,
                      json={"log_id": "5004", "build_id": manual_build.id})
    assert res.status_code == 200, res.text
    assert res.json()["build_id"] == manual_build.id
    assert db_session.query(Build).filter(Build.vin == _BM3_VIN).count() == 0
