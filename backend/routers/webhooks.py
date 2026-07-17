import os
import json
from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.db import get_db
from backend import stripe_service

router = APIRouter()

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


ENVIRONMENT = os.getenv("ENVIRONMENT", "production")


@router.post("/webhooks/stripe")
async def handle_stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()

    # Signature verification is bypassed ONLY when running in development AND no
    # webhook secret is configured (local Stripe CLI with --skip-verify). If a
    # secret is set we always verify, even in dev, so the unauthenticated path
    # can never be reached in any environment that has a real secret.
    if ENVIRONMENT == "development" and not STRIPE_WEBHOOK_SECRET:
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid payload")
    else:
        if not STRIPE_WEBHOOK_SECRET:
            raise HTTPException(status_code=400, detail="Webhook secret not configured")
        sig_header = request.headers.get("stripe-signature")
        try:
            event = stripe_service.stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid payload")
        except stripe_service.stripe.error.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid signature")

    result = stripe_service.handle_webhook_event(db, event)
    return {"status": "received", "event_type": event.get("type"), "result": result}
