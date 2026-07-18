import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from backend import config
from backend.auth.core import create_access_token, get_user_features
from backend.db import get_db
from backend.models import User

router = APIRouter()


@router.get("/api/auth/github/login")
def github_login(native: bool = False):
    if not config.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GitHub API keys missing. Set GITHUB_CLIENT_ID to use SSO.")
    # `state` is round-tripped by GitHub so the callback knows whether to return
    # to the web app or hand back to the native app via a deep link.
    state = "native" if native else "web"
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={config.GITHUB_CLIENT_ID}&scope=user&state={state}"
    )
    return RedirectResponse(url)


@router.get("/api/auth/github/callback")
async def github_callback(code: str, state: str = "web", db: Session = Depends(get_db)):
    if not config.GITHUB_CLIENT_ID or not config.GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GitHub API keys missing. Set GITHUB_CLIENT_SECRET.")

    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": config.GITHUB_CLIENT_ID,
                "client_secret": config.GITHUB_CLIENT_SECRET,
                "code": code,
            },
        )
        token_data = token_res.json()
        access_token = token_data.get("access_token")

        if not access_token:
            raise HTTPException(status_code=400, detail="Invalid GitHub code or failed to get access token")

        user_res = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        profile_data = user_res.json()
        github_id = str(profile_data.get("id"))
        username = profile_data.get("login")

        if not github_id or not username:
            raise HTTPException(status_code=400, detail="Failed to fetch GitHub profile")

        # /user only exposes a PUBLIC email; fetch the primary verified address
        # from /user/emails (covered by the `user` scope) so we can link to an
        # existing account instead of creating a duplicate.
        email = None
        email_verified = False
        try:
            emails_res = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if emails_res.status_code == 200:
                for e in emails_res.json():
                    if e.get("primary") and e.get("verified"):
                        email = e.get("email")
                        email_verified = True
                        break
        except Exception:
            pass

        user = db.query(User).filter(User.github_id == github_id).first()
        if not user:
            # Link to an existing account with the same verified email, else create.
            if email and email_verified:
                user = db.query(User).filter(User.email == email).first()
            if user:
                user.github_id = github_id
            else:
                base_username = username
                counter = 1
                while db.query(User).filter(User.username == username).first():
                    username = f"{base_username}_{counter}"
                    counter += 1
                user = User(username=username, github_id=github_id, email=email)
                db.add(user)
            db.commit()
            db.refresh(user)

        local_token = create_access_token(data={"sub": user.username, "features": get_user_features(user.username)})

        # Native app: hand the token back via a deep link so the system browser
        # closes and control returns to the app (embedded-webview OAuth is
        # discouraged by providers/app stores).
        if state == "native":
            return RedirectResponse(url=f"boostlog://auth/github?token={local_token}")

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
