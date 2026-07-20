"""Email trigger tests. mailer is a no-op in tests (RESEND_API_KEY unset), so
these monkeypatch the send functions to assert *when* they fire."""
from backend import config, mailer, stripe_service
from backend.models import User


def test_register_sends_welcome(client, monkeypatch):
    calls = []
    monkeypatch.setattr(mailer, "send_welcome", lambda to: calls.append(to))
    res = client.post("/register", json={"email": "e@example.com", "password": "pw123456"})
    assert res.status_code == 200
    assert calls == ["e@example.com"]


def test_grant_tier_emails_once_on_transition(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send_subscription_confirmation", lambda to, tier: sent.append((to, tier)))
    u = User(email="u@example.com", subscription_tier="free")

    stripe_service._grant_tier(u, "pro")
    assert u.subscription_tier == "pro"
    assert sent == [("u@example.com", "pro")]

    stripe_service._grant_tier(u, "pro")      # repeat webhook/renewal → no duplicate
    assert sent == [("u@example.com", "pro")]

    stripe_service._grant_tier(u, "tuner")    # upgrade → new confirmation
    assert sent[-1] == ("u@example.com", "tuner")

    stripe_service._grant_tier(u, "free")     # downgrade → no email
    assert len(sent) == 2


def test_mailer_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(config, "RESEND_API_KEY", None)
    # Must return quietly (no network) rather than raise.
    mailer.send_email("x@example.com", "Subject", "<p>hi</p>")


def test_invoice_paid_triggers_stripe_send(monkeypatch):
    sent = []
    monkeypatch.setattr(stripe_service.stripe.Invoice, "send_invoice", lambda iid: sent.append(iid))
    res = stripe_service._handle_invoice_paid(None, {"id": "in_123", "amount_paid": 1499})
    assert res["status"] == "invoice_sent"
    assert sent == ["in_123"]


def test_invoice_paid_zero_amount_ignored():
    res = stripe_service._handle_invoice_paid(None, {"id": "in_1", "amount_paid": 0})
    assert res["status"] == "ignored_zero_amount"
