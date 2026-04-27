import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import User
from backend.schemas import UserUpdate

router = APIRouter()


@router.get("/api/user/me")
async def get_user_me(current_user: User = Depends(get_current_user)):
    return {
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "settings": json.loads(current_user.settings_json) if current_user.settings_json else {},
    }


@router.patch("/api/user/me")
async def update_user_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.email is not None:
        current_user.email = payload.email
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.settings_json is not None:
        current_user.settings_json = payload.settings_json
    db.commit()
    return {"status": "success"}
