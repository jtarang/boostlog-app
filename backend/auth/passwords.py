import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from backend.auth.core import (
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)
from backend.config import RP_ID
from backend.db import get_db
from backend.models import User
from backend.schemas import (
    PasswordResetConfirm,
    PasswordResetRequest,
    UserCreate,
    UsernameUpdate,
)

router = APIRouter()


@router.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    return {"message": "User registered successfully"}


@router.post("/token")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/api/auth/reset-password/request")
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

    reset_url = f"{os.getenv('WP_ORIGIN', 'http://localhost:8000')}/reset-password?token={token}"
    print(f"DEBUG: Password reset for {user.username}: {reset_url}")

    return {"message": "Success", "debug_info": "Reset token generated" if RP_ID == "localhost" else None}


@router.post("/api/auth/reset-password/confirm")
def reset_password_confirm(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.password_reset_token == payload.token,
        User.password_reset_expiry > datetime.now(timezone.utc),
    ).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = get_password_hash(payload.new_password)
    user.password_reset_token = None
    user.password_reset_expiry = None
    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/api/user/change-username")
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
