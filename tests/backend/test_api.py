import io

def get_auth_headers(client):
    client.post("/register", json={"username": "testuser", "password": "testpassword"})
    res = client.post("/token", data={"username": "testuser", "password": "testpassword"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_upload_and_list_logs(client):
    headers = get_auth_headers(client)
    
    csv_content = b"Time,RPM,Boost,Timing Corr 1\n0,1000,0,0\n1,2000,10,-1.5"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "test_log.csv"
    
    # Upload
    res = client.post(
        "/api/upload", 
        files={"file": ("test_log.csv", file_bytes, "text/csv")}, 
        headers=headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["message"] == "Upload successful"
    
    # List
    res = client.get("/api/logs", headers=headers)
    assert res.status_code == 200
    logs = res.json()["logs"]
    assert len(logs) == 1
    assert logs[0]["name"] == "test_log.csv"
    
    # Fetch log content
    file_id = logs[0]["id"]
    res = client.get(f"/api/logs/{file_id}", headers=headers)
    assert res.status_code == 200
    assert b"Time,RPM,Boost" in res.content

def test_upload_unauthorized(client):
    csv_content = b"Time,RPM,Boost\n0,1000,0"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "test_log.csv"
    res = client.post(
        "/api/upload", 
        files={"file": ("test_log.csv", file_bytes, "text/csv")}, 
    )
    assert res.status_code == 401

def test_unauthorized_log_access(client):
    headers = get_auth_headers(client)
    res = client.get(f"/api/logs/wronguser_1234_test.csv", headers=headers)
    assert res.status_code == 403
