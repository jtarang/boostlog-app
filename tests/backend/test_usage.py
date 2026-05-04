import pytest
from datetime import datetime, timezone
from backend.models import User, AIUsage, SubscriptionTier, Datalog
from backend.usage import check_usage_limit, record_usage, DEFAULT_LIMITS
from fastapi import HTTPException
import io

def get_auth_headers(client, username="usage_user"):
    client.post("/register", json={"username": username, "password": "testpassword"})
    res = client.post("/token", data={"username": username, "password": "testpassword"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_check_usage_limit_free_tier(db_session):
    user = User(username="free_user", subscription_tier="free")
    db_session.add(user)
    db_session.commit()
    
    # Under limit
    assert check_usage_limit(db_session, user) is True
    
    # Exactly at limit
    usage = AIUsage(user_id=user.id, tokens_used=DEFAULT_LIMITS["free"])
    db_session.add(usage)
    db_session.commit()
    
    with pytest.raises(HTTPException) as exc:
        check_usage_limit(db_session, user)
    assert exc.value.status_code == 402

def test_check_usage_limit_pro_tier(db_session):
    user = User(username="pro_user", subscription_tier="pro")
    db_session.add(user)
    db_session.commit()
    
    # Under limit (way over free limit)
    usage = AIUsage(user_id=user.id, tokens_used=DEFAULT_LIMITS["free"] + 1000)
    db_session.add(usage)
    db_session.commit()
    
    assert check_usage_limit(db_session, user) is True

def test_custom_tier_limit(db_session):
    # Add a custom limit to the DB
    tier = SubscriptionTier(name="pro", token_limit=100)
    db_session.add(tier)
    user = User(username="custom_user", subscription_tier="pro")
    db_session.add(user)
    db_session.commit()
    
    # Under limit
    usage = AIUsage(user_id=user.id, tokens_used=50)
    db_session.add(usage)
    db_session.commit()
    assert check_usage_limit(db_session, user) is True
    
    # Over limit
    usage2 = AIUsage(user_id=user.id, tokens_used=60)
    db_session.add(usage2)
    db_session.commit()
    
    with pytest.raises(HTTPException) as exc:
        check_usage_limit(db_session, user)
    assert exc.value.status_code == 402

def test_analyze_endpoint_respects_limit(client, db_session):
    headers = get_auth_headers(client, "limited_user")
    user = db_session.query(User).filter(User.username == "limited_user").first()
    
    # 1. Upload
    csv_content = b"Time,RPM,Boost\n0,1000,0\n1,2000,10"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "limit_test.csv"
    res = client.post("/api/upload", files={"file": ("limit_test.csv", file_bytes, "text/csv")}, headers=headers)
    stored_filename = res.json()["url"].split("/")[-1]
    
    # 2. Exceed limit manually
    usage = AIUsage(user_id=user.id, tokens_used=DEFAULT_LIMITS["free"] + 1)
    db_session.add(usage)
    db_session.commit()
    
    # 3. Trigger Analysis - should fail with 402
    res = client.post(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 402
    assert "limit reached" in res.json()["detail"]

def test_chat_endpoint_respects_limit(client, db_session):
    headers = get_auth_headers(client, "chat_limit_user")
    user = db_session.query(User).filter(User.username == "chat_limit_user").first()
    
    # 1. Upload and initial analysis
    csv_content = b"Time,RPM,Boost\n0,1000,0\n1,2000,10"
    file_bytes = io.BytesIO(csv_content)
    file_bytes.name = "chat_limit_test.csv"
    res = client.post("/api/upload", files={"file": ("chat_limit_test.csv", file_bytes, "text/csv")}, headers=headers)
    stored_filename = res.json()["url"].split("/")[-1]
    res = client.post(f"/api/analyze/{stored_filename}", headers=headers)
    assert res.status_code == 200, f"Initial analysis failed: {res.text}"
    
    # 2. Exceed limit manually
    usage = AIUsage(user_id=user.id, tokens_used=DEFAULT_LIMITS["free"] + 1)
    db_session.add(usage)
    db_session.commit()
    
    # Ensure MOCK_AI_RESPONSE is NOT set to exercise the usage check
    import os
    if "MOCK_AI_RESPONSE" in os.environ:
        del os.environ["MOCK_AI_RESPONSE"]
    
    # 3. Chat - should fail with 402
    res = client.post(f"/api/analyze/{stored_filename}/chat", json={"messages": [{"role": "user", "content": "How's the boost?"}]}, headers=headers)
    assert res.status_code == 402, f"Expected 402 but got {res.status_code}: {res.text}"
    assert "limit reached" in res.json()["detail"]

def test_record_usage_logic(db_session):
    user = User(username="record_user")
    db_session.add(user)
    db_session.commit()
    
    class MockUsage:
        def __init__(self):
            self.total_tokens = 123
            self.prompt_tokens = 100
            self.completion_tokens = 23
            
    class MockResponse:
        def __init__(self):
            self.usage = MockUsage()
            self.model = "gpt-4"
            
    record_usage(db_session, user.id, MockResponse())
    
    usage_rec = db_session.query(AIUsage).filter(AIUsage.user_id == user.id).first()
    assert usage_rec is not None
    assert usage_rec.tokens_used == 123
    assert usage_rec.model_used == "gpt-4"
