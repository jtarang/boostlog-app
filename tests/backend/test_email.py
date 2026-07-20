"""Email trigger tests. mailer is a no-op in tests (RESEND_API_KEY unset), so
these monkeypatch the send functions to assert *when* they fire."""
from backend import config, mailer


def test_register_sends_welcome(client, monkeypatch):
    calls = []
    monkeypatch.setattr(mailer, "send_welcome", lambda to: calls.append(to))
    res = client.post("/register", json={"email": "e@example.com", "password": "pw123456"})
    assert res.status_code == 200
    assert calls == ["e@example.com"]


def test_mailer_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(config, "RESEND_API_KEY", None)
    # Must return quietly (no network) rather than raise.
    mailer.send_email("x@example.com", "Subject", "<p>hi</p>")
