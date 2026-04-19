import io
import pytest

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
    assert "datalog_id" in data
    
    # List
    res = client.get("/api/logs", headers=headers)
    assert res.status_code == 200
    logs = res.json()["logs"]
    assert len(logs) == 1
    assert logs[0]["name"] == "test_log.csv"
    assert "id" in logs[0]
    
    # Fetch log content
    stored_filename = logs[0]["url"].split("/")[-1]
    res = client.get(f"/api/logs/{stored_filename}", headers=headers)
    assert res.status_code == 200
    assert b"Time,RPM,Boost" in res.content

def test_analyze_and_cache(client):
    headers = get_auth_headers(client)
    
    # 1. Upload
    csv_content = b"Time,RPM,Boost\n0,1000,0\n1,2000,10"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "analysis_test.csv"
    res = client.post("/api/upload", files={"file": ("analysis_test.csv", file_bytes, "text/csv")}, headers=headers)
    stored_filename = res.json()["url"].split("/")[-1]

    # 2. Check no analysis exists
    res = client.get(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 200
    assert res.json()["analysis"] is None

    # 3. Trigger Analysis
    res = client.post(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 200
    assert "✅ Tuning looks good" in res.json()["analysis"]

    # 4. Verify persistence (cached result)
    res = client.get(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 200
    assert "✅ Tuning looks good" in res.json()["analysis"]
    assert "created_at" in res.json()

def test_list_analyses_history(client):
    headers = get_auth_headers(client)
    
    # Upload
    csv_content = b"Time,RPM\n0,1000"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "history_test.csv"
    res = client.post("/api/upload", files={"file": ("history_test.csv", file_bytes, "text/csv")}, headers=headers)
    stored_filename = res.json()["url"].split("/")[-1]

    # Trigger two analyses
    client.post(f"/api/analyze/{stored_filename}", headers=headers)
    client.post(f"/api/analyze/{stored_filename}", headers=headers)

    # List history
    res = client.get(f"/api/analyses/{stored_filename}", headers=headers)
    assert res.status_code == 200
    analyses = res.json()["analyses"]
    assert len(analyses) == 2
    assert analyses[0]["result_markdown"] is not None

def test_analyze_parameter_extraction(client):
    headers = get_auth_headers(client)
    
    # Upload a rich CSV with all columns
    csv_content = b"Time,Engine RPM,Boost Pressure (Actual),Boost Pressure (Target),Torque at Clutch (Actual),Timing Corr. Cyl 1\n0,1000,10,12,300,0\n1,6000,20,20,500,-4.5"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "rich_log.csv"
    res = client.post("/api/upload", files={"file": ("rich_log.csv", file_bytes, "text/csv")}, headers=headers)
    stored_filename = res.json()["url"].split("/")[-1]

    # Trigger Analysis
    res = client.post(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 200
    # The summary passed to the prompt should have included these values
    # Since we mocked the prompt result, we verify the endpoint doesn't crash
    assert "✅ Tuning looks good" in res.json()["analysis"]

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
    res = client.get(f"/api/logs/99_wrong_id.csv", headers=headers)
    assert res.status_code == 403
