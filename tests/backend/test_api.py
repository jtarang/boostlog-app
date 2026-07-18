import io
import pytest

def get_auth_headers(client):
    client.post("/register", json={"username": "testuser", "email": "testuser@example.com", "password": "testpassword"})
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

def test_delete_log(client):
    headers = get_auth_headers(client)

    file_bytes = io.BytesIO(b"Time,RPM\n0,1000\n1,2000")
    file_bytes.name = "delete_me.csv"
    res = client.post("/api/upload", files={"file": ("delete_me.csv", file_bytes, "text/csv")}, headers=headers)
    assert res.status_code == 200
    log_id = res.json()["datalog_id"]
    stored_filename = client.get("/api/logs", headers=headers).json()["logs"][0]["url"].split("/")[-1]

    # Delete it
    res = client.delete(f"/api/logs/{log_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "deleted"

    # Gone from the list, and the file is no longer accessible (get_log returns
    # 403 once the owning DB row is gone).
    assert client.get("/api/logs", headers=headers).json()["logs"] == []
    assert client.get(f"/api/logs/{stored_filename}", headers=headers).status_code == 403

    # Deleting again / a missing id is a 404
    assert client.delete(f"/api/logs/{log_id}", headers=headers).status_code == 404


def test_delete_log_unauthorized(client):
    headers = get_auth_headers(client)
    # No such log for this user
    assert client.delete("/api/logs/99999", headers=headers).status_code == 404


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


def _upload(client, headers, name, content):
    fb = io.BytesIO(content)
    fb.name = name
    res = client.post("/api/upload", files={"file": (name, fb, "text/csv")}, headers=headers)
    return res.json()["url"].split("/")[-1]


# A richer two-pull dataset (pedal, rpm, boost, torque, timing) so the WOT
# aggregation and RPM/torque curve both have real channels to chew on.
_BASE_CSV = (
    b"Pedal,Engine RPM,Boost Pressure (Actual),Boost Pressure (Target),Torque at Clutch (Actual),Timing Corr. Cyl 1\n"
    b"100,3000,12,14,360,-0.5\n100,4000,16,17,420,-1.0\n100,5000,18,18,460,-2.0\n100,6000,17,18,440,-3.5\n100,7000,15,16,400,-1.0\n"
)
_OPT_CSV = (
    b"Pedal,Engine RPM,Boost Pressure (Actual),Boost Pressure (Target),Torque at Clutch (Actual),Timing Corr. Cyl 1\n"
    b"100,3000,14,14,400,-0.2\n100,4000,18,18,480,-0.5\n100,5000,21,21,520,-0.8\n100,6000,20,20,500,-1.0\n100,7000,18,18,460,-0.5\n"
)


def test_tuning_compare(client):
    headers = get_auth_headers(client)
    base = _upload(client, headers, "baseline.csv", _BASE_CSV)
    opt = _upload(client, headers, "optimized.csv", _OPT_CSV)

    res = client.post("/api/tuning/compare", json={"baseline": base, "optimized": opt}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["baseline"]["name"] == "baseline.csv"
    assert data["optimized"]["name"] == "optimized.csv"
    # Optimized pull makes more torque + power and pulls less timing than baseline.
    assert data["optimized"]["max_torque_nm"] > data["baseline"]["max_torque_nm"]
    assert data["optimized"]["peak_power_hp"] > data["baseline"]["peak_power_hp"]
    assert abs(data["optimized"]["worst_timing_correction"]) < abs(data["baseline"]["worst_timing_correction"])
    # Curves are populated since RPM + torque channels exist.
    assert isinstance(data["baseline"]["curve"], list) and len(data["baseline"]["curve"]) >= 3


def test_tuning_recommend(client):
    headers = get_auth_headers(client)
    base = _upload(client, headers, "b2.csv", _BASE_CSV)
    opt = _upload(client, headers, "o2.csv", _OPT_CSV)

    res = client.post("/api/tuning/recommend", json={"baseline": base, "optimized": opt}, headers=headers)
    assert res.status_code == 200
    assert "✅ Tuning looks good" in res.json()["recommendations"]


def test_tuning_compare_unauthorized_log(client):
    headers = get_auth_headers(client)
    base = _upload(client, headers, "mine.csv", _BASE_CSV)
    res = client.post("/api/tuning/compare", json={"baseline": base, "optimized": "99_not_mine.csv"}, headers=headers)
    assert res.status_code == 403
