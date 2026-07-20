"""Unified SSO/OAuth.

Google, GitHub, Microsoft and Discord go through fastapi-sso on a parametrized
pair of routes (`/api/auth/{provider}/login|callback`). Apple ("Sign in with
Apple") is hand-rolled because fastapi-sso has no Apple provider and Apple needs
an ES256-signed client-secret JWT plus a form_post (POST) callback.

Every provider maps to a column on User (github_id / google_id / microsoft_id /
discord_id / apple_id). On callback we find the user by that column; failing
that we link to an existing account by email, else create one. Google is
hard-verified by the library (raises on unverified email); the others return the
account's own managed email.
"""
import base64
import json
import logging
import re
import time
from typing import Callable, Optional
from urllib.parse import quote, urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi_sso.sso.base import SSOBase, SSOLoginError
from fastapi_sso.sso.discord import DiscordSSO
from fastapi_sso.sso.github import GithubSSO
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.microsoft import MicrosoftSSO
from oauthlib.oauth2.rfc6749.errors import OAuth2Error
from sqlalchemy.orm import Session

from backend import config, mailer
from backend.auth.core import build_access_token
from backend.db import get_db
from backend.models import User

router = APIRouter()
log = logging.getLogger(__name__)

APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"

# provider -> the User column holding that provider's subject id.
ID_ATTR = {
    "google": "google_id",
    "github": "github_id",
    "microsoft": "microsoft_id",
    "discord": "discord_id",
    "apple": "apple_id",
}


def _redirect_uri(provider: str) -> str:
    return f"{config.OAUTH_REDIRECT_BASE}/api/auth/{provider}/callback"


def _insecure() -> bool:
    # Only allow http redirect URIs for local dev.
    return config.OAUTH_REDIRECT_BASE.startswith("http://")


def _google() -> Optional[SSOBase]:
    if not (config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET):
        return None
    return GoogleSSO(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET,
                     _redirect_uri("google"), allow_insecure_http=_insecure())


def _github() -> Optional[SSOBase]:
    if not (config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET):
        return None
    return GithubSSO(config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET,
                     _redirect_uri("github"), allow_insecure_http=_insecure())


def _microsoft() -> Optional[SSOBase]:
    if not (config.MICROSOFT_CLIENT_ID and config.MICROSOFT_CLIENT_SECRET):
        return None
    return MicrosoftSSO(config.MICROSOFT_CLIENT_ID, config.MICROSOFT_CLIENT_SECRET,
                        _redirect_uri("microsoft"), allow_insecure_http=_insecure(),
                        tenant=config.MICROSOFT_TENANT)


def _discord() -> Optional[SSOBase]:
    if not (config.DISCORD_CLIENT_ID and config.DISCORD_CLIENT_SECRET):
        return None
    return DiscordSSO(config.DISCORD_CLIENT_ID, config.DISCORD_CLIENT_SECRET,
                      _redirect_uri("discord"), allow_insecure_http=_insecure())


# fastapi-sso providers (Apple is handled separately below).
PROVIDERS: dict[str, Callable[[], Optional[SSOBase]]] = {
    "google": _google,
    "github": _github,
    "microsoft": _microsoft,
    "discord": _discord,
}


def _get_sso(provider: str) -> SSOBase:
    builder = PROVIDERS.get(provider)
    if builder is None:
        raise HTTPException(status_code=404, detail="Unknown SSO provider")
    sso = builder()
    if sso is None:
        raise HTTPException(status_code=500, detail=f"{provider.title()} SSO is not configured.")
    return sso


def _derive_username(db: Session, email: Optional[str], display_name: Optional[str],
                     provider: str, provider_id: str) -> str:
    base = (email.split("@")[0] if email else "") or (display_name or "") or f"{provider}_{provider_id}"
    base = re.sub(r"[^a-zA-Z0-9_]", "_", base).strip("_") or f"{provider}user"
    username = base
    counter = 1
    while db.query(User).filter(User.username == username).first():
        username = f"{base}_{counter}"
        counter += 1
    return username


def _upsert_user(db: Session, provider: str, provider_id: str,
                 email: Optional[str], display_name: Optional[str]) -> User:
    """Find the user by provider id; else link to an existing account by email;
    else create one."""
    id_attr = ID_ATTR[provider]
    provider_id = str(provider_id)

    user = db.query(User).filter(getattr(User, id_attr) == provider_id).first()
    if user:
        return user

    created = False
    if email:
        user = db.query(User).filter(User.email == email).first()
    if user:
        setattr(user, id_attr, provider_id)
    else:
        user = User(
            username=_derive_username(db, email, display_name, provider, provider_id),
            email=email,
            full_name=display_name,
        )
        setattr(user, id_attr, provider_id)
        db.add(user)
        created = True
    db.commit()
    db.refresh(user)
    if created:
        mailer.send_welcome(user.email)  # only on first-time account creation, not on link/login
    return user


def _login_error_redirect(provider: str, state: str = "web"):
    """Return the user to the login screen with a friendly message instead of a
    500 when a provider round-trip fails (expired/reused code, denied consent,
    unverified email, provider outage, …). On native we deep-link back to the app
    (mirroring the success path) so the user isn't stranded in the browser."""
    msg = quote(f"{provider.title()} sign-in failed or expired — please try again.")
    if state == "native":
        return RedirectResponse(url=f"boostlog://auth/{provider}?error={msg}", status_code=303)
    return RedirectResponse(url=f"/app?auth_error={msg}", status_code=303)


def _issue_token_response(user: User, provider: str, state: str):
    token = build_access_token(user)
    # Native app: hand the token back via a deep link (embedded-webview OAuth is
    # discouraged by providers/app stores).
    if state == "native":
        return RedirectResponse(url=f"boostlog://auth/{provider}?token={token}")
    html_content = f'''
    <html>
        <script>
            localStorage.setItem('boostlog_token', '{token}');
            window.location.href = '/app';
        </script>
        <body>Oauth Flow Complete. Linking Datastore...</body>
    </html>
    '''
    return HTMLResponse(content=html_content)


# ── Apple ("Sign in with Apple") ──────────────────────────────────────────────
def _apple_configured() -> bool:
    return all([config.APPLE_CLIENT_ID, config.APPLE_TEAM_ID,
                config.APPLE_KEY_ID, config.APPLE_PRIVATE_KEY_B64])


def _apple_client_secret() -> str:
    """Apple's client secret is an ES256 JWT signed with the .p8 key, valid up to
    6 months."""
    now = int(time.time())
    payload = {
        "iss": config.APPLE_TEAM_ID,
        "iat": now,
        "exp": now + 15552000,  # ~180 days (Apple's max)
        "aud": "https://appleid.apple.com",
        "sub": config.APPLE_CLIENT_ID,
    }
    key_pem = base64.b64decode(config.APPLE_PRIVATE_KEY_B64).decode()
    return jwt.encode(payload, key_pem, algorithm="ES256", headers={"kid": config.APPLE_KEY_ID})


def _apple_login_redirect(native: bool):
    if not _apple_configured():
        raise HTTPException(status_code=500, detail="Apple SSO is not configured.")
    params = {
        "client_id": config.APPLE_CLIENT_ID,
        "redirect_uri": _redirect_uri("apple"),
        "response_type": "code",
        "scope": "name email",
        "response_mode": "form_post",  # required to receive name/email → Apple POSTs the callback
        "state": "native" if native else "web",
    }
    return RedirectResponse(f"{APPLE_AUTH_URL}?{urlencode(params)}")


@router.post("/api/auth/apple/callback")
async def apple_callback(request: Request, db: Session = Depends(get_db)):
    if not _apple_configured():
        raise HTTPException(status_code=500, detail="Apple SSO is not configured.")
    form = await request.form()
    code = form.get("code")
    state = form.get("state", "web")
    user_field = form.get("user")  # JSON with the name, first authorization only
    if not code:
        return _login_error_redirect("apple", state)

    try:
        async with httpx.AsyncClient() as client:
            token_res = await client.post(APPLE_TOKEN_URL, data={
                "client_id": config.APPLE_CLIENT_ID,
                "client_secret": _apple_client_secret(),
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": _redirect_uri("apple"),
            })
        id_token = token_res.json().get("id_token")
        if not id_token:
            log.warning("Apple token exchange returned no id_token: %s", token_res.text[:300])
            return _login_error_redirect("apple", state)

        # id_token came directly from Apple's token endpoint over TLS, so we read
        # its claims without re-verifying the signature.
        claims = jwt.decode(id_token, options={"verify_signature": False})
        apple_id = claims.get("sub")
        if not apple_id:
            return _login_error_redirect("apple", state)
        email = claims.get("email")

        display_name = None
        if user_field:
            try:
                name = json.loads(user_field).get("name", {})
                display_name = " ".join(filter(None, [name.get("firstName"), name.get("lastName")])) or None
            except (ValueError, TypeError):
                pass

        user = _upsert_user(db, "apple", apple_id, email, display_name)
    except Exception:
        log.exception("Unexpected Apple callback error")
        return _login_error_redirect("apple", state)
    return _issue_token_response(user, "apple", state)


# ── fastapi-sso providers (Google / GitHub / Microsoft / Discord) ─────────────
@router.get("/api/auth/{provider}/login")
async def sso_login(provider: str, native: bool = False):
    if provider == "apple":
        return _apple_login_redirect(native)
    sso = _get_sso(provider)
    # `state` is round-tripped so the callback knows whether to return to the web
    # app or hand back to the native app via a deep link.
    async with sso:
        return await sso.get_login_redirect(state="native" if native else "web")


@router.get("/api/auth/{provider}/callback")
async def sso_callback(provider: str, request: Request, state: str = "web", db: Session = Depends(get_db)):
    if provider == "apple":
        # Apple uses response_mode=form_post → see the POST route above.
        raise HTTPException(status_code=405, detail="Apple uses a POST callback")
    sso = _get_sso(provider)
    try:
        async with sso:
            sso_user = await sso.verify_and_process(request)
        if sso_user is None:
            return _login_error_redirect(provider, state)
        user = _upsert_user(db, provider, sso_user.id, sso_user.email, sso_user.display_name)
    except (OAuth2Error, SSOLoginError) as e:
        log.warning("SSO %s sign-in failed: %s", provider, e)
        return _login_error_redirect(provider, state)
    except Exception:
        log.exception("Unexpected SSO %s callback error", provider)
        return _login_error_redirect(provider, state)
    return _issue_token_response(user, provider, state)
