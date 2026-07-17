import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import User, SubscriptionTier, UserSubscription, PaymentMethod
from backend.schemas import UserUpdate, SubscriptionUpgrade, StripePaymentIntent
from backend.usage import get_monthly_usage, DEFAULT_LIMITS
from backend import stripe_service

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


@router.get("/api/stripe/config")
async def get_stripe_config():
    """Get Stripe publishable key for client-side initialization."""
    import os
    publishable_key = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
    return {"publishable_key": publishable_key}


@router.get("/api/user/usage")
async def get_user_usage(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    used = get_monthly_usage(db, current_user.id)
    tier_name = current_user.subscription_tier or "free"

    tier_config = db.query(SubscriptionTier).filter(SubscriptionTier.name == tier_name).first()
    limit = tier_config.token_limit if tier_config else DEFAULT_LIMITS.get(tier_name, DEFAULT_LIMITS["free"])

    sub = current_user.subscription
    cancel_at_period_end = bool(sub and sub.cancel_at_period_end)
    access_until = sub.current_period_end.isoformat() if (sub and cancel_at_period_end and sub.current_period_end) else None

    return {
        "used": used,
        "limit": limit,
        "tier": tier_name,
        "remaining": max(0, limit - used),
        "cancel_at_period_end": cancel_at_period_end,
        "access_until": access_until,
    }


@router.patch("/api/user/me")
async def update_user_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.email is not None:
        email = payload.email.strip().lower()
        # Email is unique across accounts — reject a value already taken by
        # someone else (a bare .commit() would otherwise raise IntegrityError).
        clash = db.query(User).filter(User.email == email, User.id != current_user.id).first()
        if clash:
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = email
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

    if payload.tier == "free":
        try:
            result = stripe_service.cancel_subscription(db, current_user)
            return result
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not current_user.subscription:
        sub = UserSubscription(user_id=current_user.id, tier="free", status="inactive")
        db.add(sub)
        db.commit()
        db.refresh(current_user)

    return {"status": "requires_payment", "tier": payload.tier, "message": "Payment method required"}


@router.get("/api/user/payment-methods")
async def get_payment_methods(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    methods = db.query(PaymentMethod).filter(PaymentMethod.user_id == current_user.id).all()
    return [
        {
            "id": pm.id,
            "stripe_payment_method_id": pm.stripe_payment_method_id,
            "card_brand": pm.card_brand,
            "card_last_four": pm.card_last_four,
            "exp_month": pm.exp_month,
            "exp_year": pm.exp_year,
            "is_default": bool(pm.is_default),
        }
        for pm in methods
    ]


@router.delete("/api/user/payment-methods/{pm_id}")
async def delete_payment_method(pm_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pm = db.query(PaymentMethod).filter(PaymentMethod.id == pm_id, PaymentMethod.user_id == current_user.id).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    try:
        stripe_service.stripe.PaymentMethod.detach(pm.stripe_payment_method_id)
    except Exception:
        pass
    db.delete(pm)
    db.commit()
    return {"status": "deleted"}


@router.post("/api/user/subscription/sync")
async def sync_subscription(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reconcile local entitlement with Stripe after the client confirms payment
    (3-D Secure / SCA). The webhook does the same reconciliation authoritatively;
    this makes the upgrade feel instant instead of waiting on webhook delivery."""
    sub = current_user.subscription
    if not sub or not sub.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No subscription to sync")
    try:
        return stripe_service.sync_subscription_status(db, current_user)
    except stripe_service.stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Stripe error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/user/subscription/reactivate")
async def reactivate_subscription(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = current_user.subscription
    if not sub or not sub.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No active subscription to reactivate")
    try:
        stripe_service.stripe.Subscription.modify(sub.stripe_subscription_id, cancel_at_period_end=False)
        sub.cancel_at_period_end = 0
        db.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/user/payment-methods/save")
async def save_payment_method(payload: StripePaymentIntent, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not payload.payment_method_id:
        raise HTTPException(status_code=400, detail="payment_method_id required")
    try:
        if not current_user.subscription:
            current_user.subscription = UserSubscription(user_id=current_user.id, tier="free", status="inactive")
            db.add(current_user.subscription)
            db.commit()

        customer_id = current_user.subscription.stripe_customer_id
        if not customer_id:
            customer_id = stripe_service.create_stripe_customer(db, current_user, current_user.email)

        stripe_service.stripe.PaymentMethod.attach(payload.payment_method_id, customer=customer_id)
        stripe_service.create_payment_method(db, current_user, payload.payment_method_id)
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/user/payment-methods/{pm_id}/set-default")
async def set_default_payment_method(pm_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pm = db.query(PaymentMethod).filter(PaymentMethod.id == pm_id, PaymentMethod.user_id == current_user.id).first()
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    db.query(PaymentMethod).filter(PaymentMethod.user_id == current_user.id).update({"is_default": 0})
    pm.is_default = 1
    db.commit()
    return {"status": "updated"}


@router.post("/api/user/subscription/create-payment-intent")
async def create_payment_intent(payload: StripePaymentIntent, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.tier not in ["pro", "tuner"]:
        raise HTTPException(status_code=400, detail="Invalid tier for payment")
    if not payload.payment_method_id:
        raise HTTPException(status_code=400, detail="Payment method required")

    try:
        if not current_user.subscription:
            current_user.subscription = UserSubscription(user_id=current_user.id, tier="free", status="inactive")
            db.add(current_user.subscription)
            db.commit()

        customer_id = current_user.subscription.stripe_customer_id
        if not customer_id:
            customer_id = stripe_service.create_stripe_customer(db, current_user, current_user.email)

        stripe_service.create_payment_method(db, current_user, payload.payment_method_id)
        return stripe_service.create_subscription(db, current_user, payload.tier, payload.payment_method_id)

    except stripe_service.stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Stripe error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
