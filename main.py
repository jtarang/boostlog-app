from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from passlib.context import CryptContext
from pydantic import BaseModel
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


load_dotenv()

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

aws_secrets_str = get_secret(os.getenv("AWS_SECRET_NAME", "boostlog/prd/secrets"))
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
    hashed_password = Column(String, nullable=True)
    github_id = Column(String, unique=True, index=True, nullable=True)

Base.metadata.create_all(bind=engine)

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

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    with open("static/index.html", "r") as f:
        return f.read()

# --- ROUTES ---

class UserCreate(BaseModel):
    username: str
    password: str

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
                window.location.href = '/';
            </script>
            <body>Oauth Flow Complete. Linking Datastore...</body>
        </html>
        '''
        return HTMLResponse(content=html_content)

@app.post("/api/analyze/{filename}")
async def analyze_log(filename: str, current_user: User = Depends(get_current_user)):
    filename = os.path.basename(filename)
    if not filename.startswith(f"{current_user.id}_"):
        raise HTTPException(status_code=403, detail="Not authorized to access this log")
        
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Log file not found")
        
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
    
    model_name = os.getenv("LLM_MODEL", "ollama/llama3")
    api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")
    
    prompt = f"""You are a master automotive tuner. Analyze this aggregated boostlog summary from a high-performance engine:
    {summary}
    
    Output a 3-paragraph markdown report addressing:
    1. Overall peak performance (Torque, RPM, Boost if available).
    2. Any dangerous ignition timing corrections (values lower than -3.0 are considered severe knock).
    3. Tuning recommendations for safety and power.
    Respond exclusively in Markdown format.
    """
    
    try:
        response = completion(
            model=model_name,
            api_base=api_base,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )
        return {"analysis": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

@app.post("/api/upload")
async def upload_log(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    file_id = str(uuid.uuid4())
    safe_filename = os.path.basename(file.filename)
    filename = f"{current_user.id}_{file_id}_{safe_filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {
        "message": "Upload successful", 
        "file_id": file_id,
        "filename": file.filename,
        "url": f"/api/logs/{filename}"
    }

@app.get("/api/logs/{filename}")
async def get_log(filename: str, current_user: User = Depends(get_current_user)):
    filename = os.path.basename(filename)
    if not filename.startswith(f"{current_user.id}_"):
        raise HTTPException(status_code=403, detail="Not authorized to access this log")
        
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=filename, content_disposition_type="attachment")
    return {"error": "File not found"}

@app.get("/api/logs")
async def list_logs(current_user: User = Depends(get_current_user)):
    files = []
    if os.path.exists(UPLOAD_DIR):
        all_files = [os.path.join(UPLOAD_DIR, f) for f in os.listdir(UPLOAD_DIR) if f.endswith('.csv') and f.startswith(f"{current_user.id}_")]
        all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        
        for file_path in all_files:
            f = os.path.basename(file_path)
            parts = f.split('_', 2)
            original_name = parts[2] if len(parts) > 2 else f
            files.append({
                "id": f,
                "name": original_name,
                "url": f"/api/logs/{f}"
            })
    return {"logs": files}
