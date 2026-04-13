import pytest
import subprocess
import time
import os
import requests

@pytest.fixture(scope="session", autouse=True)
def start_server():
    env = os.environ.copy()
    env["DATABASE_URL"] = "sqlite:///./data/test_e2e.db"
    env["AWS_ACCESS_KEY_ID"] = "testing"
    env["AWS_SECRET_ACCESS_KEY"] = "testing"
    env["SKIP_AWS_FETCH"] = "true"
    
    # Start the server
    p = subprocess.Popen(
        ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
        env=env
    )
    
    # Wait until it responds
    for _ in range(10):
        try:
            res = requests.get("http://127.0.0.1:8001")
            if res.status_code == 200:
                break
        except requests.ConnectionError:
            pass
        time.sleep(1)
        
    try:
        yield
    finally:
        p.terminate()
        p.wait()
        
        # Cleanup DB
        if os.path.exists("./data/test_e2e.db"):
            os.remove("./data/test_e2e.db")
