import pytest
import subprocess
import time
import os
import requests

@pytest.fixture(scope="session", autouse=True)
def start_server():
    # Ensure data directory exists
    os.makedirs("./data", exist_ok=True)
    
    # Manually create tables for the test DB since main.py no longer calls create_all()
    from main import Base
    from sqlalchemy import create_engine
    test_db_url = "sqlite:///./data/test_e2e.db"
    test_engine = create_engine(test_db_url)
    Base.metadata.create_all(bind=test_engine)

    env = os.environ.copy()
    env["DATABASE_URL"] = test_db_url
    env["AWS_ACCESS_KEY_ID"] = "testing"
    env["AWS_SECRET_ACCESS_KEY"] = "testing"
    env["SKIP_AWS_FETCH"] = "true"
    env["MOCK_AI_RESPONSE"] = "true"
    
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

@pytest.fixture(scope="function")
def authenticated_page(page):
    import uuid
    username = f"user_{uuid.uuid4().hex[:8]}"
    page.goto("http://127.0.0.1:8001/app")
    # Register/Login flow
    page.locator(".auth-tabs .tab:nth-child(2)").click()
    page.locator("#authUsername").fill(username)
    page.locator("#authPassword").fill("password123")
    page.locator("#authSubmitBtn").click()
    # Wait for login to complete
    from playwright.sync_api import expect
    expect(page.locator("#authOverlay")).to_be_hidden()
    return page
