import re
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from backend import config
from backend.auth.core import create_access_token, get_user_features
from backend.db import get_db
from backend.models import User

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _derive_username(db: Session, email: str, name: str) -> str:
    """Google has no username, so derive one from the email local-part (or name),
    sanitized, then de-duplicated like the GitHub flow."""
    base = (email.split("@")[0] if email else "") or (name or "user")
    base = re.sub(r"[^a-zA-Z0-9_]", "_", base).strip("_") or "user"
    username = base
    counter = 1
    while db.query(User).filter(User.username == username).first():
        username = f"{base}_{counter}"
        counter += 1
    return username


@router.get("/api/auth/google/login")
def google_login(native: bool = False):
    if not config.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google API keys missing. Set GOOGLE_CLIENT_ID to use SSO.")
    # `state` is round-tripped by Google so the callback knows whether to return
    # to the web app or hand back to the native app via a deep link.
    params = {
        "client_id": config.GOOGLE_CLIENT_ID,
        "redirect_uri": config.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": "native" if native else "web",
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/api/auth/google/callback")
async def google_callback(code: str, state: str = "web", db: Session = Depends(get_db)):
    if not config.GOOGLE_CLIENT_ID or not config.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google API keys missing. Set GOOGLE_CLIENT_SECRET.")

    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            GOOGLE_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": config.GOOGLE_CLIENT_ID,
                "client_secret": config.GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": config.GOOGLE_REDIRECT_URI,
            },
        )
        token_data = token_res.json()
        access_token = token_data.get("access_token")

        if not access_token:
            raise HTTPException(status_code=400, detail="Invalid Google code or failed to get access token")

        user_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        profile_data = user_res.json()
        google_id = profile_data.get("sub")
        email = profile_data.get("email")
        name = profile_data.get("name")

        if not google_id:
            raise HTTPException(status_code=400, detail="Failed to fetch Google profile")

        user = db.query(User).filter(User.google_id == google_id).first()
        if not user:
            # Link to an existing account with the same verified email, else create.
            if email and profile_data.get("email_verified"):
                user = db.query(User).filter(User.email == email).first()
            if user:
                user.google_id = google_id
            else:
                user = User(
                    username=_derive_username(db, email, name),
                    google_id=google_id,
                    email=email,
                    full_name=name,
                )
                db.add(user)
            db.commit()
            db.refresh(user)

        local_token = create_access_token(data={"sub": user.username, "features": get_user_features(user.username)})

        # Native app: hand the token back via a deep link (embedded-webview OAuth
        # is discouraged by providers/app stores).
        if state == "native":
            return RedirectResponse(url=f"boostlog://auth/google?token={local_token}")

        html_content = f'''
        <html>
            <script>
                localStorage.setItem('boostlog_token', '{local_token}');
                window.location.href = '/app';
            </script>
            <body>Oauth Flow Complete. Linking Datastore...</body>
        </html>
        '''
        return HTMLResponse(content=html_content)
