import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import User, SubscriptionTier
from backend.schemas import UserUpdate, SubscriptionUpgrade
from backend.usage import get_monthly_usage, DEFAULT_LIMITS

router = APIRouter()


@router.get("/api/user/me")
async def get_user_me(current_user: User = Depends(get_current_user)):
    return {
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "subscription_tier": current_user.subscription_tier,
        "settings": json.loads(current_user.settings_json) if current_user.settings_json else {},
    }


@router.get("/api/user/usage")
async def get_user_usage(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    used = get_monthly_usage(db, current_user.id)
    tier_name = current_user.subscription_tier or "free"
    
    tier_config = db.query(SubscriptionTier).filter(SubscriptionTier.name == tier_name).first()
    if tier_config:
        limit = tier_config.token_limit
    else:
        limit = DEFAULT_LIMITS.get(tier_name, DEFAULT_LIMITS["free"])
        
    return {
        "used": used,
        "limit": limit,
        "tier": tier_name,
        "remaining": max(0, limit - used)
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


@router.post("/api/user/subscription/upgrade")
async def upgrade_subscription(payload: SubscriptionUpgrade, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    valid_tiers = ["free", "pro", "tuner"]
    if payload.tier not in valid_tiers:
        raise HTTPException(status_code=400, detail=f"Invalid tier. Must be one of {valid_tiers}")

    current_user.subscription_tier = payload.tier
    db.commit()

    return {"status": "success", "tier": payload.tier}
