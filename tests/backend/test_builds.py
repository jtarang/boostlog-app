import io


def auth(client, username="testuser", password="testpassword"):
    client.post("/register", json={"username": username, "password": password})
    res = client.post("/token", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def upload_log(client, headers, name="log.csv"):
    csv = b"Time,RPM\n0,1000\n1,2000"
    res = client.post(
        "/api/upload",
        files={"file": (name, io.BytesIO(csv), "text/csv")},
        headers=headers,
    )
    assert res.status_code == 200
    return res.json()


def test_create_list_rename_delete_build(client):
    headers = auth(client)

    # Empty list
    res = client.get("/api/builds", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"builds": []}

    # Create
    res = client.post("/api/builds", json={"name": "M3 Build"}, headers=headers)
    assert res.status_code == 200
    bid = res.json()["id"]
    assert res.json()["name"] == "M3 Build"

    # List
    res = client.get("/api/builds", headers=headers)
    assert len(res.json()["builds"]) == 1

    # Rename
    res = client.put(f"/api/builds/{bid}", json={"name": "M3 Stage 2"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "M3 Stage 2"

    # Delete
    res = client.delete(f"/api/builds/{bid}", headers=headers)
    assert res.status_code == 200
    assert client.get("/api/builds", headers=headers).json()["builds"] == []


def test_create_build_blank_name_rejected(client):
    headers = auth(client)
    res = client.post("/api/builds", json={"name": "   "}, headers=headers)
    assert res.status_code == 400


def test_move_log_into_build(client):
    headers = auth(client)
    log = upload_log(client, headers)
    build = client.post("/api/builds", json={"name": "Track Days"}, headers=headers).json()

    # Move into build
    res = client.put(
        f"/api/logs/{log['id']}/build",
        json={"build_id": build["id"]},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["build_id"] == build["id"]

    # Verify list reflects new grouping
    logs = client.get("/api/logs", headers=headers).json()["logs"]
    assert logs[0]["build_id"] == build["id"]

    # Detach (back to Unassigned)
    res = client.put(
        f"/api/logs/{log['id']}/build",
        json={"build_id": None},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["build_id"] is None


def test_delete_build_detaches_logs(client):
    headers = auth(client)
    log = upload_log(client, headers)
    build = client.post("/api/builds", json={"name": "Temp"}, headers=headers).json()

    client.put(
        f"/api/logs/{log['id']}/build",
        json={"build_id": build["id"]},
        headers=headers,
    )

    res = client.delete(f"/api/builds/{build['id']}", headers=headers)
    assert res.status_code == 200

    # Log should still exist, just unassigned
    logs = client.get("/api/logs", headers=headers).json()["logs"]
    assert len(logs) == 1
    assert logs[0]["build_id"] is None


def test_cannot_access_other_users_build(client):
    a_headers = auth(client, "alice", "pw")
    b_headers = auth(client, "bob", "pw")

    build = client.post("/api/builds", json={"name": "Alice's"}, headers=a_headers).json()

    # Bob cannot rename
    res = client.put(f"/api/builds/{build['id']}", json={"name": "Hacked"}, headers=b_headers)
    assert res.status_code == 404

    # Bob cannot delete
    res = client.delete(f"/api/builds/{build['id']}", headers=b_headers)
    assert res.status_code == 404

    # Bob cannot move his own log into Alice's build
    log = upload_log(client, b_headers, name="bob.csv")
    res = client.put(
        f"/api/logs/{log['id']}/build",
        json={"build_id": build["id"]},
        headers=b_headers,
    )
    assert res.status_code == 404


def test_move_unknown_build_returns_404(client):
    headers = auth(client)
    log = upload_log(client, headers)
    res = client.put(
        f"/api/logs/{log['id']}/build",
        json={"build_id": 9999},
        headers=headers,
    )
    assert res.status_code == 404
