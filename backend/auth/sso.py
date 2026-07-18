"""Unified SSO/OAuth via fastapi-sso.

One parametrized pair of routes (`/api/auth/{provider}/login` and
`/api/auth/{provider}/callback`) drives every provider, so adding one is a
single entry in PROVIDERS. The provider URLs are kept identical to the old
per-provider routes so registered OAuth redirect URIs don't change.

Each provider maps to a column on User (github_id / google_id / microsoft_id).
On callback we find the user by that column; failing that we link to an existing
account by email, else create one. Google is hard-verified by the library
(raises on unverified email); GitHub and Microsoft return the account's own
managed email.
"""
import re
from typing import Callable, NamedTuple, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi_sso.sso.base import SSOBase
from fastapi_sso.sso.github import GithubSSO
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.microsoft import MicrosoftSSO
from sqlalchemy.orm import Session

from backend import config
from backend.auth.core import create_access_token, get_user_features
from backend.db import get_db
from backend.models import User

router = APIRouter()


class Provider(NamedTuple):
    build: Callable[[], Optional[SSOBase]]  # None when the provider isn't configured
    id_attr: str  # the User column holding this provider's subject id


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


PROVIDERS = {
    "google": Provider(_google, "google_id"),
    "github": Provider(_github, "github_id"),
    "microsoft": Provider(_microsoft, "microsoft_id"),
}


def _get_sso(provider: str) -> SSOBase:
    entry = PROVIDERS.get(provider)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown SSO provider")
    sso = entry.build()
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


def _process_sso_user(db: Session, provider: str, sso_user) -> User:
    id_attr = PROVIDERS[provider].id_attr
    provider_id = str(sso_user.id)

    user = db.query(User).filter(getattr(User, id_attr) == provider_id).first()
    if user:
        return user

    # Link to an existing account by email, else create.
    email = sso_user.email
    if email:
        user = db.query(User).filter(User.email == email).first()
    if user:
        setattr(user, id_attr, provider_id)
    else:
        user = User(
            username=_derive_username(db, email, sso_user.display_name, provider, provider_id),
            email=email,
            full_name=sso_user.display_name,
        )
        setattr(user, id_attr, provider_id)
        db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/api/auth/{provider}/login")
async def sso_login(provider: str, native: bool = False):
    sso = _get_sso(provider)
    # `state` is round-tripped so the callback knows whether to return to the web
    # app or hand back to the native app via a deep link.
    async with sso:
        return await sso.get_login_redirect(state="native" if native else "web")


@router.get("/api/auth/{provider}/callback")
async def sso_callback(provider: str, request: Request, state: str = "web", db: Session = Depends(get_db)):
    sso = _get_sso(provider)
    async with sso:
        sso_user = await sso.verify_and_process(request)

    if sso_user is None:
        raise HTTPException(status_code=400, detail=f"Failed to authenticate with {provider}")

    user = _process_sso_user(db, provider, sso_user)
    token = create_access_token(data={"sub": user.username, "features": get_user_features(user.username)})

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
