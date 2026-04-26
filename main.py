from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship
from passlib.context import CryptContext
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone
import jwt
import os
import uuid
import shutil
import httpx
import json
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import polars as pl
from dotenv import load_dotenv
import base64
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
    base64url_to_bytes,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    RegistrationCredential,
    AuthenticationCredential,
    AttestationConveyancePreference,
    PublicKeyCredentialDescriptor,
    AuthenticatorTransport,
)

load_dotenv()

RP_ID = os.getenv("RP_ID", "localhost")
RP_NAME = "Boostlog"

# Temporary store for WebAuthn challenges
# In production, use Redis or a DB table with ttl
webauthn_challenges = {} 

def get_secret(secret_name):
    if os.getenv("SKIP_AWS_FETCH") == "true":
        return None
        
    region_name = os.getenv("AWS_REGION", "us-east-1")
    try:
        session = boto3.session.Session()
        client = session.client(service_name='secretsmanager', region_name=region_name)
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        if 'SecretString' in get_secret_value_response:
            return get_secret_value_response['SecretString']
    except (ClientError, NoCredentialsError) as e:
        print(f"Boto3 Error getting secret {secret_name} (bypassing due to local environment): {e}")
    return None

aws_secrets_str = get_secret(os.getenv("AWS_SECRET_NAME", "boostlog.app/prd/secrets"))
if aws_secrets_str:
    aws_secrets = json.loads(aws_secrets_str)
else:
    aws_secrets = {}

# --- DB SETUP ---
os.makedirs("data", exist_ok=True)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/boostlog.db")

# Fix for SQLAlchemy 1.4+ which requires 'postgresql://' instead of 'postgres://'
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Build engine with conditional arguments
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    github_id = Column(String, unique=True, index=True, nullable=True)
    settings_json = Column(Text, nullable=True) # JSON blob for frontend prefs
    
    # WebAuthn / Passkeys
    webauthn_id = Column(String, unique=True, index=True, nullable=True)
    
    # Password Reset
    password_reset_token = Column(String, unique=True, index=True, nullable=True)
    password_reset_expiry = Column(DateTime(timezone=True), nullable=True)

    datalogs = relationship("Datalog", back_populates="owner", cascade="all, delete-orphan")
    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")
    credentials = relationship("UserCredential", back_populates="user", cascade="all, delete-orphan")

class UserCredential(Base):
    __tablename__ = "user_credentials"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    credential_id = Column(String, unique=True, index=True, nullable=False)
    public_key = Column(String, nullable=False)
    sign_count = Column(Integer, default=0)
    transports = Column(String, nullable=True) # JSON list
    name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="credentials")

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    vin = Column(String, nullable=True)
    vehicle_model = Column(String, nullable=True)
    customer_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String, nullable=True)  # manual override: active, in_progress, completed, on_hold
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner = relationship("User", back_populates="projects")
    # Logs detach (project_id -> NULL) when the project is deleted
    datalogs = relationship("Datalog", back_populates="project", passive_deletes=True)

class Datalog(Base):
    __tablename__ = "datalogs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    stored_filename = Column(String, unique=True, nullable=False)  # e.g. 2_uuid_original.csv
    display_name = Column(String, nullable=False)
    source_filename = Column(String, nullable=False) # Original filename from user's disk
    uploaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner = relationship("User", back_populates="datalogs")
    project = relationship("Project", back_populates="datalogs")
    analyses = relationship("Analysis", back_populates="datalog", cascade="all, delete-orphan")

class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    datalog_id = Column(Integer, ForeignKey("datalogs.id"), nullable=False)
    model_used = Column(String, nullable=False)
    result_markdown = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    datalog = relationship("Datalog", back_populates="analyses")

# Base.metadata.create_all(bind=engine)  # Handled by Alembic migrations

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- AUTH SETUP ---
SECRET_KEY = aws_secrets.get("SECRET_KEY") or os.getenv("SECRET_KEY", "fallback_local_secret_key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# --- APP SETUP ---
app = FastAPI(title="Boostlog Web App")
UPLOAD_DIR = "data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def ensure_demo_user():
    db = SessionLocal()
    try:
        demo_user = db.query(User).filter(User.username == "demo").first()
        if not demo_user:
            hashed_pw = get_password_hash("demo")
            db.add(User(username="demo", hashed_password=hashed_pw))
            db.commit()
            print("Demo user created (demo/demo)")
    finally:
        db.close()

# Global flag — only one analysis can run at a time across the whole server
_analysis_in_progress: bool = False

@app.get("/", response_class=HTMLResponse)
async def serve_landing():
    with open("static/landing/index.html", "r") as f:
        return f.read()

@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    with open("static/app/index.html", "r") as f:
        return f.read()

# --- ROUTES ---

class UserCreate(BaseModel):
    username: str
    password: str

class LogRename(BaseModel):
    new_name: str

class ProjectCreate(BaseModel):
    name: str
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    settings_json: Optional[str] = None

class LogMove(BaseModel):
    project_id: Optional[int] = None

class PasswordResetRequest(BaseModel):
    username_or_email: str

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

class UsernameUpdate(BaseModel):
    new_username: str

@app.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    return {"message": "User registered successfully"}

@app.post("/token")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# --- WEBAUTHN / PASSKEYS ---

def _credential_descriptor(c: "UserCredential") -> PublicKeyCredentialDescriptor:
    transports = []
    if c.transports:
        for t in json.loads(c.transports):
            try:
                transports.append(AuthenticatorTransport(t))
            except ValueError:
                continue
    return PublicKeyCredentialDescriptor(
        id=base64url_to_bytes(c.credential_id),
        transports=transports or None,
    )

@app.get("/api/auth/webauthn/register/options")
def webauthn_register_options(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.webauthn_id:
        current_user.webauthn_id = str(uuid.uuid4())
        db.commit()

    # Get existing credentials to exclude (skip any rows whose stored id can't be decoded)
    existing_credentials = []
    for c in current_user.credentials:
        try:
            existing_credentials.append(_credential_descriptor(c))
        except Exception as e:
            print(f"WARN: Skipping unreadable credential {c.id} for user {current_user.username}: {e}")
            continue

    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=current_user.webauthn_id.encode("utf-8"),
        user_name=current_user.username,
        user_display_name=current_user.full_name or current_user.username,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=None,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=existing_credentials,
    )
    print(f"DEBUG: Generated registration options for {current_user.username}")


    webauthn_challenges[f"reg_{current_user.id}"] = options.challenge
    return json.loads(options_to_json(options))

@app.post("/api/auth/webauthn/register/verify")
async def webauthn_register_verify(payload: dict, name: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    challenge = webauthn_challenges.pop(f"reg_{current_user.id}", None)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    try:
        origin = os.getenv("WP_ORIGIN")
        if not origin:
            origin = f"http://{RP_ID}:8000" if RP_ID == "localhost" else f"https://{RP_ID}"
        
        print(f"DEBUG: Verifying registration for {current_user.username} (RP_ID: {RP_ID}, Origin: {origin})")

        verification = verify_registration_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=RP_ID,
        )
    except Exception as e:
        print(f"ERROR: Registration verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    # Save the new credential
    # We use bytes_to_base64url on the verified bytes to ensure DB storage is correct
    cred_id_str = bytes_to_base64url(verification.credential_id)

    cred_name = (name or "").strip() or f"Passkey {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    new_cred = UserCredential(
        user_id=current_user.id,
        credential_id=cred_id_str,
        public_key=base64.b64encode(verification.credential_public_key).decode("utf-8"),
        sign_count=verification.sign_count,
        transports=json.dumps(payload.get("response", {}).get("transports", [])),
        name=cred_name,
    )

    db.add(new_cred)
    db.commit()
    print(f"DEBUG: Successfully registered passkey for {current_user.username}")
    return {"status": "success", "message": "Passkey registered"}

@app.get("/api/auth/webauthn/login/options")
def webauthn_login_options(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_credentials = []
    for c in user.credentials:
        try:
            existing_credentials.append(_credential_descriptor(c))
        except Exception as e:
            print(f"ERROR: Failed to parse credential {c.id} for user {username}: {e}")
            continue

    if not existing_credentials:
        print(f"DEBUG: No valid passkeys found for user {username}")
        raise HTTPException(status_code=400, detail="No passkeys registered for this user")

    try:
        options = generate_authentication_options(
            rp_id=RP_ID,
            allow_credentials=existing_credentials,
            user_verification=UserVerificationRequirement.PREFERRED,
        )

        webauthn_challenges[f"login_{username}"] = options.challenge
        return json.loads(options_to_json(options))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/webauthn/login/verify")
async def webauthn_login_verify(payload: dict, username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    challenge = webauthn_challenges.pop(f"login_{username}", None)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    # Find the credential in DB. Note: we search by the same string ID sent by the payload
    cred_id = payload.get("id")
    db_cred = db.query(UserCredential).filter(UserCredential.credential_id == cred_id).first()
    if not db_cred or db_cred.user_id != user.id:
        raise HTTPException(status_code=400, detail="Credential not found")

    try:
        origin = os.getenv("WP_ORIGIN")
        if not origin:
            origin = f"http://{RP_ID}:8000" if RP_ID == "localhost" else f"https://{RP_ID}"

        verification = verify_authentication_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=RP_ID,
            credential_public_key=base64.b64decode(db_cred.public_key),
            credential_current_sign_count=db_cred.sign_count,
        )

    except Exception as e:
        print(f"ERROR: Login verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    # Update sign count
    db_cred.sign_count = verification.new_sign_count
    db.commit()

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# --- DISCOVERABLE-CREDENTIAL (USERNAMELESS / AUTOFILL) LOGIN ---

@app.get("/api/auth/webauthn/login/discoverable/options")
def webauthn_login_discoverable_options():
    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    challenge_key = bytes_to_base64url(options.challenge)
    webauthn_challenges[f"disc_{challenge_key}"] = options.challenge
    return json.loads(options_to_json(options))

@app.post("/api/auth/webauthn/login/discoverable/verify")
async def webauthn_login_discoverable_verify(payload: dict, db: Session = Depends(get_db)):
    response = payload.get("response", {}) or {}
    client_data_b64 = response.get("clientDataJSON")
    if not client_data_b64:
        raise HTTPException(status_code=400, detail="Missing clientDataJSON")

    try:
        client_data = json.loads(base64url_to_bytes(client_data_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid clientDataJSON")

    challenge_key = client_data.get("challenge")
    challenge = webauthn_challenges.pop(f"disc_{challenge_key}", None) if challenge_key else None
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge missing or expired")

    cred_id = payload.get("id")
    db_cred = db.query(UserCredential).filter(UserCredential.credential_id == cred_id).first()
    if not db_cred:
        raise HTTPException(status_code=400, detail="Credential not found")

    user = db.query(User).filter(User.id == db_cred.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user_handle_b64 = response.get("userHandle")
    if user_handle_b64:
        try:
            user_handle = base64url_to_bytes(user_handle_b64).decode("utf-8")
        except Exception:
            user_handle = None
        if user_handle and user.webauthn_id and user_handle != user.webauthn_id:
            raise HTTPException(status_code=400, detail="User handle mismatch")

    try:
        origin = os.getenv("WP_ORIGIN")
        if not origin:
            origin = f"http://{RP_ID}:8000" if RP_ID == "localhost" else f"https://{RP_ID}"

        verification = verify_authentication_response(
            credential=payload,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=RP_ID,
            credential_public_key=base64.b64decode(db_cred.public_key),
            credential_current_sign_count=db_cred.sign_count,
        )
    except Exception as e:
        print(f"ERROR: Discoverable login verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    db_cred.sign_count = verification.new_sign_count
    db.commit()

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/passkeys")
def list_passkeys(current_user: User = Depends(get_current_user)):
    return [
        {
            "id": c.id,
            "name": c.name or f"Passkey #{c.id}",
            "transports": json.loads(c.transports) if c.transports else [],
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in current_user.credentials
    ]

@app.delete("/api/auth/passkeys/{cred_id}")
def delete_passkey(cred_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cred = db.query(UserCredential).filter(
        UserCredential.id == cred_id,
        UserCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey not found")
    db.delete(cred)
    db.commit()
    return {"status": "success"}

class PasskeyRename(BaseModel):
    name: str

@app.patch("/api/auth/passkeys/{cred_id}")
def rename_passkey(cred_id: int, payload: PasskeyRename, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_name = payload.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    cred = db.query(UserCredential).filter(
        UserCredential.id == cred_id,
        UserCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey not found")
    cred.name = new_name
    db.commit()
    return {"status": "success", "name": cred.name}

# --- PASSWORD RESET & USERNAME CHANGE ---

@app.post("/api/auth/reset-password/request")
def reset_password_request(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        (User.username == payload.username_or_email) | (User.email == payload.username_or_email)
    ).first()
    
    if not user:
        return {"message": "If an account exists, a reset link will be provided."}
    
    token = str(uuid.uuid4())
    user.password_reset_token = token
    user.password_reset_expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    db.commit()
    
    # Mocking email send
    reset_url = f"{os.getenv('WP_ORIGIN', 'http://localhost:8000')}/reset-password?token={token}"
    print(f"DEBUG: Password reset for {user.username}: {reset_url}")
    
    return {"message": "Success", "debug_info": "Reset token generated" if RP_ID == "localhost" else None}

@app.post("/api/auth/reset-password/confirm")
def reset_password_confirm(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.password_reset_token == payload.token,
        User.password_reset_expiry > datetime.now(timezone.utc)
    ).first()
    
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    
    user.hashed_password = get_password_hash(payload.new_password)
    user.password_reset_token = None
    user.password_reset_expiry = None
    db.commit()
    return {"message": "Password updated successfully"}

@app.post("/api/user/change-username")
def change_username(payload: UsernameUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_username = payload.new_username.strip()
    if not new_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
        
    existing = db.query(User).filter(User.username == new_username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
        
    current_user.username = new_username
    db.commit()
    
    access_token = create_access_token(data={"sub": current_user.username})
    return {"status": "success", "access_token": access_token}

# --- GITHUB OAUTH ---
GITHUB_CLIENT_ID = aws_secrets.get("GITHUB_CLIENT_ID") or os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = aws_secrets.get("GITHUB_CLIENT_SECRET") or os.getenv("GITHUB_CLIENT_SECRET")

@app.get("/api/auth/github/login")
def github_login():
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GitHub API keys missing. Set GITHUB_CLIENT_ID to use SSO.")
    url = f"https://github.com/login/oauth/authorize?client_id={GITHUB_CLIENT_ID}&scope=user"
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url)

@app.get("/api/auth/github/callback")
async def github_callback(code: str, db: Session = Depends(get_db)):
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GitHub API keys missing. Set GITHUB_CLIENT_SECRET.")
        
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code
            }
        )
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        
        if not access_token:
            raise HTTPException(status_code=400, detail="Invalid GitHub code or failed to get access token")

        user_res = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        profile_data = user_res.json()
        github_id = str(profile_data.get("id"))
        username = profile_data.get("login")

        if not github_id or not username:
            raise HTTPException(status_code=400, detail="Failed to fetch GitHub profile")

        user = db.query(User).filter(User.github_id == github_id).first()
        if not user:
            # Check if username exists manually (fallback logic)
            base_username = username
            counter = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base_username}_{counter}"
                counter += 1
                
            user = User(username=username, github_id=github_id)
            db.add(user)
            db.commit()
            db.refresh(user)
            
        local_token = create_access_token(data={"sub": user.username})
        
        html_content = f'''
        <html>
            <script>
                localStorage.setItem('boostlog_token', '{local_token}');
                window.location.href = '/app';
            </script>
            <body>Oauth Flow Complete. Linking Datastore...</body>
        </html>
        '''
        return HTMLResponse(content=html_content)

@app.post("/api/analyze/{filename}")
async def analyze_log(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized to access this log")

    global _analysis_in_progress
    if _analysis_in_progress:
        raise HTTPException(status_code=429, detail="An analysis is already running. Please wait for it to finish.")

    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Log file not found")

    _analysis_in_progress = True
        
    try:
        df = pl.read_csv(file_path, ignore_errors=True)
        cols = df.columns
        
        def find_col(aliases):
            for c in cols:
                for a in aliases:
                    if a.lower() in c.lower():
                        return c
            return None
            
        rpm_col = find_col(['engine rpm', 'rpm'])
        boost_act_col = find_col(['boost pressure (actual)', 'map', 'manifold absolute pressure'])
        boost_tgt_col = find_col(['boost pressure (target)'])
        timing_cols = [c for c in cols if 'timing corr' in c.lower()]
        torque_col = find_col(['torque at clutch', 'torque (actual)'])
        
        summary = {"rows_analyzed": len(df)}
        
        if rpm_col: 
            summary["max_rpm"] = float(df[rpm_col].max())
            
        if boost_tgt_col and boost_act_col:
            summary["max_boost_target"] = float(df[boost_tgt_col].max())
            summary["max_boost_actual"] = float(df[boost_act_col].max())
            
        if torque_col:
            # Filter garbage 16777216 and 1024
            valid_torque = df.filter((pl.col(torque_col) < 10000))
            if len(valid_torque) > 0:
                summary["max_torque_nm"] = float(valid_torque[torque_col].max())
            
        worst_timing = 0.0
        for tc in timing_cols:
            min_tc = float(df.select(pl.col(tc).cast(pl.Float64, strict=False)).min().item())
            if min_tc is not None and min_tc < worst_timing: 
                worst_timing = min_tc
        summary["worst_timing_correction"] = worst_timing
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to aggregate CSV parameters: {str(e)}")
        
    from litellm import completion
    
    # OLLAMA_MODEL holds the bare model name (e.g. llama3.2:1b)
    # litellm requires the 'ollama/' prefix to route correctly
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
    model_name = f"ollama/{ollama_model}"
    api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")
    
    prompt = f"""You are **Moose** — a seasoned, no-nonsense professional automotive tuner with 20+ years of experience on forced-induction engines (turbo, supercharged, E85, pump gas). You have just received an aggregated data summary parsed from a real dyno datalog file. Your job is to give the owner an honest, technically precise, and actionable analysis.

---

## Dyno Run Summary Data
```
{summary}
```

---

## Your Analysis Must Cover All of the Following Sections

### 1. 🔥 Peak Performance Snapshot
- State peak RPM, peak torque (in Nm and estimated whp if possible), and peak boost (actual).
- Comment on where peak power likely falls in the RPM band based on the data.
- If torque or boost data is missing, clearly flag it.

### 2. 📈 Boost Behavior & Efficiency
- Compare **boost target vs boost actual**. Calculate the delta (target − actual).
- A delta of more than **1.5 psi** is a boost control concern (wastegate, boost solenoid, or plumbing leak).
- A delta of more than **3.0 psi** is a **serious boost control failure** — flag it clearly.
- Comment on whether boost builds linearly (healthy) or spikes/drops (tuning concern).

### 3. ⚡ Ignition Timing & Knock Assessment
Use this severity scale for timing correction values (negative = retard due to knock):
| Correction Range | Severity | Label |
|---|---|---|
| 0.0 to -1.5 deg | Normal | ✅ SAFE |
| -1.5 to -3.0 deg | Borderline | ⚠️ MONITOR |
| -3.0 deg or worse | Critical Knock | 🚨 DANGER |

- Report the **worst timing correction observed** and its severity label.
- If knock is detected mid-pull (not just at peak), flag the RPM window where it occurred.
- Explain what commonly causes knock at that RPM range (heat soak, lean AFR, octane, charge temp).

### 4. 🛡️ Safety Verdict
Give an overall run verdict in one of three states:
- ✅ **SAFE TO RUN** — No critical issues, minor notes only.
- ⚠️ **PROCEED WITH CAUTION** — Borderline readings. Reduce boost or retest before street/track.
- 🚨 **DO NOT RUN** — Critical knock, severe boost loss, or anomalous data detected. Immediate attention required.

Justify the verdict clearly in 2–3 sentences.

### 5. 🔧 Tuner Action Items
Provide a **prioritized checklist** of specific actions the tuner or owner must take, ordered from most critical to least:
- Be specific (e.g., "Reduce boost target by 2 psi between 3500–4500 RPM" not just "reduce boost").
- Include fueling, ignition, and mechanical checks where relevant.
- If data is insufficient for a specific channel, recommend logging it on the next pull.

---

**Format Rules:**
- Use Markdown headers (##, ###), tables, and bullet points.
- Bold all severity labels and key values.
- Do not use filler phrases like "great run" or "impressive numbers" — be direct and professional.
- If the data summary is sparse or missing key channels, state exactly what additional logging is needed.
"""
    
    mock_response = os.getenv("MOCK_AI_RESPONSE")
    if mock_response:
        result_text = "## AI Analysis\n\n**Verdict**: ✅ Tuning looks good.\n\nEverything is within safe limits."
        model_name = "mock/turbo-tuner"
    else:
        import asyncio
        def _run_llm():
            return completion(
                model=model_name,
                api_base=api_base,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
        try:
            response = await asyncio.to_thread(_run_llm)
            result_text = response.choices[0].message.content
        except Exception as e:
            _analysis_in_progress = False
            raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

    _analysis_in_progress = False

    # Persist the analysis result
    analysis = Analysis(datalog_id=datalog.id, model_used=model_name, result_markdown=result_text)
    db.add(analysis)
    db.commit()

    return {"analysis": result_text}

@app.get("/api/analyze/{filename}")
async def get_cached_analysis(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the most recent saved analysis for a log, if it exists."""
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized")

    latest = db.query(Analysis).filter(
        Analysis.datalog_id == datalog.id
    ).order_by(Analysis.created_at.desc()).first()

    if not latest:
        return {"analysis": None}
    return {"analysis": latest.result_markdown, "model": latest.model_used, "created_at": latest.created_at.isoformat()}

@app.get("/api/analyses/{filename}")
async def list_analyses(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return all saved analyses for a log, newest first."""
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized")

    analyses = db.query(Analysis).filter(
        Analysis.datalog_id == datalog.id
    ).order_by(Analysis.created_at.desc()).all()

    return {"analyses": [
        {
            "id": a.id,
            "model_used": a.model_used,
            "created_at": a.created_at.isoformat(),
            "result_markdown": a.result_markdown
        }
        for a in analyses
    ]}

@app.post("/api/upload")
async def upload_log(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    safe_filename = os.path.basename(file.filename)

    # Return existing record if this user already uploaded a file with the same name
    existing = db.query(Datalog).filter(
        Datalog.user_id == current_user.id,
        Datalog.source_filename == safe_filename
    ).first()
    if existing:
        return {
            "message": "Already uploaded",
            "datalog_id": existing.id,
            "id": existing.id,
            "filename": existing.display_name,
            "url": f"/api/logs/{existing.stored_filename}",
            "duplicate": True
        }

    file_id = str(uuid.uuid4())
    stored_filename = f"{current_user.id}_{file_id}_{safe_filename}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    datalog = Datalog(user_id=current_user.id, stored_filename=stored_filename, display_name=safe_filename, source_filename=safe_filename)
    db.add(datalog)
    db.commit()
    db.refresh(datalog)

    return {
        "message": "Upload successful",
        "datalog_id": datalog.id,
        "id": datalog.id,
        "filename": safe_filename,
        "url": f"/api/logs/{stored_filename}",
        "duplicate": False
    }

@app.get("/api/proxy-csv")
async def proxy_csv(url: str, _current_user: User = Depends(get_current_user)):
    # Only allow bootmod3 dlog URLs to prevent open-proxy abuse
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.netloc not in ("bootmod3.net", "www.bootmod3.net"):
        raise HTTPException(status_code=400, detail="Only bootmod3.net URLs are supported")
    if not parsed.path.startswith("/dlog"):
        raise HTTPException(status_code=400, detail="Only /dlog paths are supported")

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        try:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"bootmod3 returned {e.response.status_code}")
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))

    content_type = r.headers.get("content-type", "")
    if "html" in content_type:
        raise HTTPException(status_code=502, detail="bootmod3 returned HTML — the log ID may be invalid or private")

    from fastapi.responses import Response
    return Response(content=r.content, media_type="text/csv")


@app.get("/api/logs/{filename}")
async def get_log(filename: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized to access this log")

    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=datalog.display_name, content_disposition_type="attachment")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/api/logs")
async def list_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalogs = db.query(Datalog).filter(
        Datalog.user_id == current_user.id
    ).order_by(Datalog.uploaded_at.desc()).all()

    return {"logs": [
        {
            "id": d.id,
            "name": d.display_name,
            "url": f"/api/logs/{d.stored_filename}",
            "uploaded_at": d.uploaded_at.isoformat(),
            "project_id": d.project_id,
        }
        for d in datalogs
    ]}

@app.put("/api/logs/{log_id}/rename")
async def rename_log(log_id: int, rename_data: LogRename, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id
    ).first()
    
    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")
        
    datalog.display_name = rename_data.new_name
    db.commit()

    return {"id": datalog.id, "name": datalog.display_name}

# --- PROJECTS ---

@app.get("/api/projects")
async def list_projects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(Project).filter(
        Project.user_id == current_user.id
    ).order_by(Project.created_at.asc()).all()

    result = []
    for p in projects:
        logs = db.query(Datalog).filter(Datalog.project_id == p.id).all()
        log_count = len(logs)
        last_activity = None
        if logs:
            latest = max(l.uploaded_at for l in logs if l.uploaded_at)
            if latest:
                last_activity = latest.isoformat()
        result.append({
            "id": p.id,
            "name": p.name,
            "vin": p.vin,
            "vehicle_model": p.vehicle_model,
            "customer_name": p.customer_name,
            "notes": p.notes,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "log_count": log_count,
            "last_activity": last_activity
        })
    return {"projects": result}

@app.post("/api/projects")
async def create_project(payload: ProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    
    project = Project(
        user_id=current_user.id,
        name=name,
        vin=payload.vin.strip() if payload.vin else None,
        vehicle_model=payload.vehicle_model.strip() if payload.vehicle_model else None,
        customer_name=payload.customer_name.strip() if payload.customer_name else None,
        notes=payload.notes.strip() if payload.notes else None,
        status=payload.status.strip() if payload.status else None
    )
    
    db.add(project)
    db.commit()
    db.refresh(project)
    return {
        "id": project.id, 
        "name": project.name, 
        "vin": project.vin,
        "vehicle_model": project.vehicle_model,
        "customer_name": project.customer_name,
        "notes": project.notes,
        "status": project.status,
        "created_at": project.created_at.isoformat() if project.created_at else None
    }

@app.put("/api/projects/{project_id}")
async def rename_project(project_id: int, payload: ProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    project.name = name
    db.commit()
    return {"id": project.id, "name": project.name}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Detach logs from this project so they reappear in "Unassigned"
    db.query(Datalog).filter(Datalog.project_id == project.id).update({Datalog.project_id: None})
    db.delete(project)
    db.commit()
    return {"deleted": project_id}

@app.put("/api/logs/{log_id}/project")
async def move_log_to_project(log_id: int, payload: LogMove, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    datalog = db.query(Datalog).filter(
        Datalog.id == log_id,
        Datalog.user_id == current_user.id
    ).first()
    if not datalog:
        raise HTTPException(status_code=404, detail="Log not found")

    if payload.project_id is not None:
        project = db.query(Project).filter(
            Project.id == payload.project_id,
            Project.user_id == current_user.id
        ).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    datalog.project_id = payload.project_id
    db.commit()
    return {"id": datalog.id, "project_id": datalog.project_id}
# --- USER SETTINGS ---
@app.get("/api/user/me")
async def get_user_me(current_user: User = Depends(get_current_user)):
    return {
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "settings": json.loads(current_user.settings_json) if current_user.settings_json else {}
    }

@app.patch("/api/user/me")
async def update_user_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.email is not None:
        current_user.email = payload.email
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.settings_json is not None:
        current_user.settings_json = payload.settings_json
    db.commit()
    return {"status": "success"}

# --- PROJECT DETAILS ---
@app.get("/api/projects/{project_id}")
async def get_project_details(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": project.id,
        "name": project.name,
        "vin": project.vin,
        "vehicle_model": project.vehicle_model,
        "customer_name": project.customer_name,
        "notes": project.notes,
        "status": project.status,
        "created_at": project.created_at.isoformat() if project.created_at else None
    }

@app.patch("/api/projects/{project_id}")
async def update_project_details(project_id: int, payload: ProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if payload.name is not None:
        project.name = payload.name
    if payload.vin is not None:
        project.vin = payload.vin
    if payload.vehicle_model is not None:
        project.vehicle_model = payload.vehicle_model
    if payload.customer_name is not None:
        project.customer_name = payload.customer_name
    if payload.notes is not None:
        project.notes = payload.notes
    if payload.status is not None:
        project.status = payload.status
        
    db.commit()
    return {"status": "success"}
