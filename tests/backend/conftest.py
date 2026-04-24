import os
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"

import pytest
import tempfile
import boto3
from moto import mock_aws
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Initialize moto Mock before importing main.py!
_mock = mock_aws()
_mock.start()

# Pre-seed our mock secret
_client = boto3.client('secretsmanager', region_name='us-east-1')
_client.create_secret(
    Name="boostlog.app/prd/secrets",
    SecretString='{"SECRET_KEY": "mocked_secret_key_from_moto", "GITHUB_CLIENT_ID": "mock_id", "GITHUB_CLIENT_SECRET": "mock_secret"}'
)

import main
from main import app, get_db, Base

@pytest.fixture(scope="session", autouse=True)
def configure_upload_dir():
    with tempfile.TemporaryDirectory() as tmpdirname:
        main.UPLOAD_DIR = tmpdirname
        yield

@pytest.fixture(scope="function", autouse=True)
def mock_litellm(monkeypatch):
    from unittest.mock import MagicMock
    mock_res = MagicMock()
    mock_res.choices[0].message.content = "## AI Analysis\n\n**Verdict**: ✅ Tuning looks good.\n\nEverything is within safe limits."
    monkeypatch.setattr("litellm.completion", lambda **kwargs: mock_res)
    return mock_res

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function", autouse=True)
def db_session():
    # Inject test engine and session into main app to handle startup events correctly
    main.engine = engine
    main.SessionLocal = TestingSessionLocal
    
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
            
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
