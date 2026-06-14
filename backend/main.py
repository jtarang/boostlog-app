from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend import config, db
from backend.auth import github as github_router
from backend.auth import passwords as passwords_router
from backend.auth import webauthn as webauthn_router
from backend.auth.core import get_password_hash
from backend.models import User, SubscriptionTier
from backend.routers import analyze, chat, logs, builds, users, tuning


@asynccontextmanager
async def lifespan(app: FastAPI):
    session = db.SessionLocal()
    try:
        demo_user = session.query(User).filter(User.username == "demo").first()
        if not demo_user:
            hashed_pw = get_password_hash("demo")
            session.add(User(username="demo", hashed_password=hashed_pw))
            session.commit()
            print("Demo user created (demo/demo)")

        # Seed Subscription Tiers
        try:
            default_tiers = [
                ("free", 50_000),
                ("pro", 5_000_000),
                ("enterprise", 100_000_000),
            ]
            for name, limit in default_tiers:
                exists = session.query(SubscriptionTier).filter(SubscriptionTier.name == name).first()
                if not exists:
                    session.add(SubscriptionTier(name=name, token_limit=limit))
            session.commit()
        except Exception as e:
            session.rollback()
            print(f"Skipping subscription tier seeding: {e}")
    finally:
        session.close()
    yield


app = FastAPI(title="Boostlog Web App", lifespan=lifespan)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.ALLOWED_HOSTS)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_landing():
    with open("static/landing/index.html", "r") as f:
        return f.read()


@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    with open("static/app/index.html", "r") as f:
        return f.read()


app.include_router(passwords_router.router)
app.include_router(webauthn_router.router)
app.include_router(github_router.router)
app.include_router(analyze.router)
app.include_router(chat.router)
app.include_router(logs.router)
app.include_router(builds.router)
app.include_router(users.router)
app.include_router(tuning.router)
