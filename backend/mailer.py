"""Transactional email via Resend.

A thin wrapper over the Resend HTTP API (httpx — no extra SDK). Every send is
best-effort: it never raises, so a mail hiccup can't break registration, login,
or a Stripe webhook. When RESEND_API_KEY / MAIL_FROM aren't configured (local
dev, tests) it no-ops and just logs.
"""
import logging
from typing import Optional

import httpx

from backend import config

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def _configured() -> bool:
    return bool(config.RESEND_API_KEY and config.MAIL_FROM)


def _layout(heading: str, body_html: str) -> str:
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="font-size:20px;margin:0 0 16px">{heading}</h1>
  {body_html}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="font-size:12px;color:#64748b;margin:0">boostLog · datalog analysis for tuners</p>
</div>"""


def send_email(to: Optional[str], subject: str, html: str) -> None:
    if not to:
        return
    if not _configured():
        log.info("email skipped (Resend not configured): to=%s subject=%r", to, subject)
        return
    try:
        r = httpx.post(
            RESEND_URL,
            json={"from": config.MAIL_FROM, "to": [to], "subject": subject, "html": html},
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            timeout=10,
        )
        if r.status_code >= 300:
            log.warning("Resend send failed (%s) to=%s: %s", r.status_code, to, r.text[:300])
    except Exception:
        log.exception("Resend send error to=%s subject=%r", to, subject)


def send_welcome(to: Optional[str]) -> None:
    send_email(to, "Welcome to boostLog", _layout(
        "Welcome to boostLog",
        "<p>Your account is ready. Upload a datalog and let the AI break down your "
        "boost, timing, and fueling.</p>"
        '<p><a href="https://boostlog.app/app" style="color:#8338EC">Open boostLog →</a></p>',
    ))


def send_password_reset(to: Optional[str], reset_url: str) -> None:
    send_email(to, "Reset your boostLog password", _layout(
        "Reset your password",
        "<p>Click below to set a new password. This link expires in 1 hour. If you "
        "didn't request this, you can ignore this email.</p>"
        f'<p><a href="{reset_url}" style="color:#8338EC">Reset password →</a></p>',
    ))


def send_subscription_confirmation(to: Optional[str], tier: str) -> None:
    send_email(to, f"You're on boostLog {tier.title()}", _layout(
        f"You're on {tier.title()} 🎉",
        f"<p>Your <strong>{tier.title()}</strong> subscription is active — thanks for "
        "supporting boostLog. Your higher usage limits are live now.</p>"
        '<p><a href="https://boostlog.app/app" style="color:#8338EC">Open boostLog →</a></p>',
    ))
