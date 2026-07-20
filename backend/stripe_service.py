import os
from datetime import datetime, timezone
import stripe
from sqlalchemy.orm import Session
from backend.models import User, PaymentMethod, UserSubscription

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# Pin the API version so response shapes we depend on are stable across SDK
# upgrades — specifically latest_invoice.payment_intent (the SCA client_secret
# location) and top-level current_period_* on the subscription. Newer API
# versions relocate these; pinning keeps the SCA flow deterministic.
stripe.api_version = "2024-06-20"

STRIPE_PRICE_IDS = {
    "pro": os.getenv("STRIPE_PRICE_ID_PRO", "price_placeholder_pro"),
    "tuner": os.getenv("STRIPE_PRICE_ID_TUNER", "price_placeholder_tuner"),
}

TIER_PRICES = {
    "free": {"amount": 0, "interval": None},
    "pro": {"amount": 1499, "interval": "month"},  # $14.99 in cents
    "tuner": {"amount": 2999, "interval": "month"},  # $29.99 in cents
}

# Statuses under which the subscription is actually paid-for and access should
# be granted. Anything else (incomplete, past_due, unpaid, incomplete_expired)
# means payment did not clear — we must NOT grant the paid tier.
ACTIVE_STATUSES = {"active", "trialing"}


def _grant_tier(user: User, tier: str) -> None:
    """Set the user's entitlement tier. Idempotent across the several grant paths
    (create/switch, client-side sync, and the webhook). Payment confirmation is
    handled by Stripe's own receipt email, so we send nothing here."""
    if user.subscription_tier == tier:
        return
    user.subscription_tier = tier


def _read(obj, key):
    """Read a field from either a Stripe object (attr) or a webhook dict (key)."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _extract_period(stripe_sub):
    """Return (start, end) epoch seconds for the current billing period.

    Handles both older Stripe SDKs (period on the Subscription) and SDK >= 15 /
    newer API versions where current_period_start/end moved onto the
    subscription item. Works for Stripe objects and raw webhook dicts alike.
    Returns (None, None) when neither location has them.
    """
    start = _read(stripe_sub, "current_period_start")
    end = _read(stripe_sub, "current_period_end")
    if end is None:
        try:
            items = _read(stripe_sub, "items")
            data = items["data"] if isinstance(items, dict) else items.data
            item = data[0]
            start = _read(item, "current_period_start") or start
            end = _read(item, "current_period_end") or end
        except (KeyError, IndexError, TypeError, AttributeError):
            pass
    return start, end


def _client_secret_from_sub(stripe_sub):
    """Pull the PaymentIntent client_secret from a subscription's latest invoice.

    Requires the subscription to be created with
    expand=["latest_invoice.payment_intent"]. Returns None if the invoice has no
    associated PaymentIntent (e.g. a $0 / trial subscription that needs no
    payment). Falls back to the newer confirmation_secret location for forward
    compatibility.
    """
    invoice = _read(stripe_sub, "latest_invoice")
    if invoice is None:
        return None
    pi = _read(invoice, "payment_intent")
    if pi is not None:
        cs = _read(pi, "client_secret")
        if cs:
            return cs
    conf = _read(invoice, "confirmation_secret")
    if conf is not None:
        return _read(conf, "client_secret")
    return None


def get_or_create_customer(user: User) -> str:
    """Get Stripe customer ID for user, create if doesn't exist."""
    if not user.subscription:
        return None  # Needs to be created via Stripe API first

    if user.subscription.stripe_customer_id:
        return user.subscription.stripe_customer_id

    return None


def create_stripe_customer(db: Session, user: User, email: str) -> str:
    """Create a Stripe customer and save the ID."""
    if not email:
        # Every billing customer must have an email (receipts, dashboard lookup,
        # dunning). GitHub-login users start without one and are prompted for it
        # before they can subscribe.
        raise ValueError("An email address is required before subscribing. Please add one to your account.")
    try:
        customer = stripe.Customer.create(
            email=email,
            metadata={"user_id": user.id}
        )

        if not user.subscription:
            sub = UserSubscription(user_id=user.id, stripe_customer_id=customer.id, tier="free", status="inactive")
            db.add(sub)
        else:
            user.subscription.stripe_customer_id = customer.id

        db.commit()
        return customer.id
    except stripe.error.StripeError as e:
        raise Exception(f"Failed to create Stripe customer: {str(e)}")


def create_payment_method(db: Session, user: User, stripe_pm_id: str) -> PaymentMethod:
    """Save payment method to database, returning existing record if already saved."""
    existing = db.query(PaymentMethod).filter(
        PaymentMethod.stripe_payment_method_id == stripe_pm_id
    ).first()
    if existing:
        return existing

    try:
        pm = stripe.PaymentMethod.retrieve(stripe_pm_id)
        card = pm.card

        payment_method = PaymentMethod(
            user_id=user.id,
            stripe_payment_method_id=stripe_pm_id,
            card_last_four=card.last4,
            card_brand=card.brand.upper(),
            exp_month=card.exp_month,
            exp_year=card.exp_year,
            is_default=1 if not user.payment_methods else 0
        )

        db.add(payment_method)
        db.commit()
        return payment_method
    except stripe.error.StripeError as e:
        raise Exception(f"Failed to save payment method: {str(e)}")


def _switch_plan(db: Session, user: User, tier: str) -> dict:
    """Move an existing subscription to a different price in place.

    Used when the user already has a live subscription and changes tiers, so we
    never create a second concurrent subscription. The price difference is
    prorated onto the next invoice (create_prorations), so there is no immediate
    charge and therefore no SCA challenge on a switch.
    """
    sub = user.subscription
    existing = stripe.Subscription.retrieve(sub.stripe_subscription_id)
    item_id = existing["items"]["data"][0]["id"]

    updated = stripe.Subscription.modify(
        sub.stripe_subscription_id,
        items=[{"id": item_id, "price": STRIPE_PRICE_IDS[tier]}],
        proration_behavior="create_prorations",
        cancel_at_period_end=False,
    )

    sub.tier = tier
    sub.status = updated.status
    sub.cancel_at_period_end = 0
    period_start, period_end = _extract_period(updated)
    if period_start:
        sub.current_period_start = datetime.fromtimestamp(period_start, tz=timezone.utc)
    if period_end:
        sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
    if updated.status in ACTIVE_STATUSES:
        _grant_tier(user, tier)
    db.commit()

    return {
        "status": updated.status,
        "tier": tier,
        "requires_action": False,
        "client_secret": None,
        "stripe_subscription_id": updated.id,
        "next_renewal": period_end,
    }


def create_subscription(db: Session, user: User, tier: str, payment_method_id: str) -> dict:
    """Create a Stripe subscription for the user."""
    if tier == "free":
        raise ValueError("Cannot create subscription for free tier")

    try:
        customer_id = user.subscription.stripe_customer_id if user.subscription else None
        if not customer_id:
            customer_id = create_stripe_customer(db, user, user.email)

        # Attach payment method to customer and set as default
        stripe.PaymentMethod.attach(payment_method_id, customer=customer_id)
        stripe.Customer.modify(
            customer_id,
            invoice_settings={"default_payment_method": payment_method_id}
        )

        # Already subscribed → switch the plan on the EXISTING subscription rather
        # than creating a second one (which would double-bill the customer).
        if (
            user.subscription
            and user.subscription.stripe_subscription_id
            and user.subscription.status in {"active", "trialing", "past_due"}
        ):
            return _switch_plan(db, user, tier)

        # default_incomplete: the subscription starts 'incomplete' with a
        # PaymentIntent that the browser must confirm (stripe.confirmCardPayment).
        # That is what drives 3-D Secure / SCA. We expand the PaymentIntent so we
        # can hand its client_secret back to the client.
        stripe_sub = stripe.Subscription.create(
            customer=customer_id,
            items=[{"price": STRIPE_PRICE_IDS[tier]}],
            default_payment_method=payment_method_id,
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            expand=["latest_invoice.payment_intent"],
        )

        # Record the target tier and what Stripe reported. Entitlement
        # (user.subscription_tier) is granted ONLY once the payment is confirmed
        # — via sync_subscription_status after client confirmation, or the
        # customer.subscription.updated webhook. It is never granted here, so an
        # unconfirmed or failed 3-D Secure challenge cannot unlock the paid tier.
        user.subscription.stripe_subscription_id = stripe_sub.id
        user.subscription.tier = tier
        user.subscription.status = stripe_sub.status
        user.subscription.cancel_at_period_end = 0
        period_start, period_end = _extract_period(stripe_sub)
        if period_start:
            user.subscription.current_period_start = datetime.fromtimestamp(period_start, tz=timezone.utc)
        if period_end:
            user.subscription.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

        # A subscription that is already active (e.g. a 100%-off coupon or a
        # trial with nothing to pay) needs no client confirmation — grant now.
        if stripe_sub.status in ACTIVE_STATUSES:
            _grant_tier(user, tier)
        db.commit()

        return {
            "status": stripe_sub.status,
            "tier": tier,
            "requires_action": stripe_sub.status not in ACTIVE_STATUSES,
            "client_secret": _client_secret_from_sub(stripe_sub),
            "stripe_subscription_id": stripe_sub.id,
            "next_renewal": period_end,
        }
    except stripe.error.StripeError as e:
        raise Exception(f"Failed to create subscription: {str(e)}")


def _persist_default_card(db: Session, user: User, stripe_sub) -> None:
    """Save the subscription's default payment method to the user's saved cards.

    Called only once the subscription is active (payment confirmed), so a card
    used for a subscription that never completed — e.g. an abandoned or failed
    3-D Secure challenge — is never persisted to the account. Idempotent via
    create_payment_method, and best-effort: card persistence must never fail the
    entitlement grant.
    """
    pm_id = _read(stripe_sub, "default_payment_method")
    if pm_id is not None and not isinstance(pm_id, str):
        pm_id = _read(pm_id, "id")  # may arrive expanded rather than as an id
    if not pm_id:
        return
    try:
        create_payment_method(db, user, pm_id)
    except Exception:
        pass


def sync_subscription_status(db: Session, user: User) -> dict:
    """Re-fetch the subscription from Stripe and reconcile local state.

    Called after the client confirms the PaymentIntent so entitlement is granted
    immediately rather than waiting on the webhook. The webhook remains the
    source of truth and performs the same reconciliation.
    """
    sub = user.subscription
    if not sub or not sub.stripe_subscription_id:
        raise ValueError("No subscription to sync")

    stripe_sub = stripe.Subscription.retrieve(sub.stripe_subscription_id)
    sub.status = stripe_sub.status
    period_start, period_end = _extract_period(stripe_sub)
    if period_start:
        sub.current_period_start = datetime.fromtimestamp(period_start, tz=timezone.utc)
    if period_end:
        sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

    if stripe_sub.status in ACTIVE_STATUSES:
        _grant_tier(user, sub.tier)
        _persist_default_card(db, user, stripe_sub)
    db.commit()

    return {"status": stripe_sub.status, "tier": user.subscription_tier}


def cancel_subscription(db: Session, user: User) -> dict:
    """Schedule subscription to cancel at period end, downgrading to free."""
    # No Stripe subscription — just set the tier directly
    if not user.subscription or not user.subscription.stripe_subscription_id:
        _grant_tier(user, "free")
        if user.subscription:
            user.subscription.tier = "free"
            user.subscription.status = "inactive"
        db.commit()
        return {"status": "success", "tier": "free", "immediate": True}

    try:
        updated = stripe.Subscription.modify(
            user.subscription.stripe_subscription_id,
            cancel_at_period_end=True
        )

        user.subscription.cancel_at_period_end = 1
        user.subscription.status = updated.status
        period_end = getattr(updated, 'current_period_end', None)
        if period_end:
            user.subscription.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
        db.commit()

        return {
            "status": "success",
            "tier": user.subscription.tier,
            "immediate": False,
            "access_until": user.subscription.current_period_end.isoformat() if user.subscription.current_period_end else None,
        }
    except stripe.error.StripeError as e:
        raise Exception(f"Failed to cancel subscription: {str(e)}")


def handle_webhook_event(db: Session, event) -> dict:
    """Handle incoming Stripe webhook events."""
    event_type = _read(event, "type")
    data_container = _read(event, "data")
    data = _read(data_container, "object") if data_container else {}

    if event_type == "customer.subscription.updated":
        return _handle_subscription_updated(db, data)
    elif event_type == "customer.subscription.deleted":
        return _handle_subscription_deleted(db, data)
    elif event_type == "invoice.payment_failed":
        return _handle_payment_failed(db, data)

    return {"status": "unhandled_event"}


def _handle_subscription_updated(db: Session, subscription) -> dict:
    """Handle subscription update events."""
    sub_id = _read(subscription, "id")
    user_sub = db.query(UserSubscription).filter(
        UserSubscription.stripe_subscription_id == sub_id
    ).first()

    if user_sub:
        status = _read(subscription, "status")
        user_sub.status = status if status is not None else user_sub.status
        period_start, period_end = _extract_period(subscription)
        if period_start:
            user_sub.current_period_start = datetime.fromtimestamp(period_start, tz=timezone.utc)
        if period_end:
            user_sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
        # Source-of-truth grant: once Stripe confirms payment (e.g. after a
        # 3-D Secure challenge completes), promote the account to its target
        # tier. This is the authoritative counterpart to sync_subscription_status.
        if user_sub.status in ACTIVE_STATUSES and user_sub.tier and user_sub.tier != "free":
            _grant_tier(user_sub.user, user_sub.tier)
            _persist_default_card(db, user_sub.user, subscription)
        db.commit()
        return {"status": "updated"}

    return {"status": "subscription_not_found"}


def _handle_subscription_deleted(db: Session, subscription) -> dict:
    """Handle subscription deletion events."""
    sub_id = _read(subscription, "id")
    user_sub = db.query(UserSubscription).filter(
        UserSubscription.stripe_subscription_id == sub_id
    ).first()

    if user_sub:
        user_sub.stripe_subscription_id = None
        user_sub.tier = "free"
        user_sub.status = "cancelled"
        user = user_sub.user
        _grant_tier(user, "free")
        db.commit()
        return {"status": "downgraded_to_free"}

    return {"status": "subscription_not_found"}


def _handle_payment_failed(db: Session, invoice) -> dict:
    """Handle payment failure events."""
    customer_id = _read(invoice, "customer")
    user_sub = db.query(UserSubscription).filter(
        UserSubscription.stripe_customer_id == customer_id
    ).first()

    if user_sub:
        user_sub.status = "past_due"
        db.commit()
        return {"status": "marked_past_due"}

    return {"status": "customer_not_found"}
