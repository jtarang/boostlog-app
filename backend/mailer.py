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


_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _button(text: str, url: str) -> str:
    # Bulletproof (table-based) CTA — renders consistently across email clients.
    return f"""\
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0">
        <tr><td bgcolor="#8338EC" style="border-radius:8px">
          <a href="{url}" style="display:inline-block;padding:12px 24px;color:#ffffff;
             font-family:{_FONT};font-size:14px;font-weight:600;text-decoration:none">{text}</a>
        </td></tr>
      </table>"""


def _layout(heading: str, intro_html: str, cta_text: str = None, cta_url: str = None) -> str:
    # Table-based, inline styles only — the reliable subset for email clients.
    # Dark header (app bg #0F172A) with the boostLog wordmark + purple accent,
    # light content card, purple CTA. Matches the app's theme.
    cta = _button(cta_text, cta_url) if cta_text and cta_url else ""
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;margin:0;padding:0">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background-color:#0f172a;padding:18px 28px">
        <span style="font-family:{_FONT};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em">boost<span style="color:#8338EC">Log</span></span>
      </td></tr>
      <tr><td style="padding:28px;font-family:{_FONT};color:#0f172a;font-size:15px;line-height:1.6">
        <h1 style="font-size:20px;font-weight:700;margin:0 0 12px">{heading}</h1>
        {intro_html}
        {cta}
      </td></tr>
      <tr><td style="padding:16px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:{_FONT};font-size:12px;color:#94a3b8">
        boostLog · datalog analysis for tuners
      </td></tr>
    </table>
  </td></tr>
</table>"""


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
        "<p style='margin:0'>Your account is ready. Upload a datalog and let the AI "
        "break down your boost, timing, and fueling.</p>",
        "Open boostLog", "https://boostlog.app/app",
    ))


def send_password_reset(to: Optional[str], reset_url: str) -> None:
    send_email(to, "Reset your boostLog password", _layout(
        "Reset your password",
        "<p style='margin:0'>Click below to set a new password. This link expires in "
        "1 hour. If you didn't request this, you can ignore this email.</p>",
        "Reset password", reset_url,
    ))
