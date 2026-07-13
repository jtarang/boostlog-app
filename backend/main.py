from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend import config, db
from backend.auth import github as github_router
from backend.auth import passwords as passwords_router
from backend.auth import webauthn as webauthn_router
from backend.auth.core import get_password_hash
from backend.models import User, SubscriptionTier
from backend.routers import analyze, chat, logs, builds, users, tuning
from backend.routers import bootmod3 as bootmod3_router


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

# The native (Capacitor) app loads from capacitor://localhost (iOS) and
# http(s)://localhost (Android), so it calls the API cross-origin. Auth is
# bearer-token (no cookies), so allow_credentials stays off.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_landing():
    with open("static/landing/index.html", "r") as f:
        return f.read()


@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    with open("static/app/index.html", "r") as f:
        return f.read()


# Browsers and iOS probe these well-known root paths regardless of <link> tags.
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")


@app.get("/apple-touch-icon.png", include_in_schema=False)
@app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
async def apple_touch_icon():
    return FileResponse("static/apple-touch-icon.png")


# PWA: web app manifest (served from root so install metadata is found).
@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return JSONResponse(
        {
            "name": "boostLog",
            "short_name": "boostLog",
            "description": "High-performance datalog visualizer and AI tuning agent.",
            "start_url": "/app",
            "scope": "/",
            "display": "standalone",
            "background_color": "#0f172a",
            "theme_color": "#0f172a",
            "orientation": "any",
            "icons": [
                {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
                {"src": "/static/apple-touch-icon.png", "sizes": "180x180", "type": "image/png"},
            ],
        },
        media_type="application/manifest+json",
    )


# PWA: service worker must be served from root so its scope covers the whole app.
@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    return FileResponse("static/sw.js", media_type="application/javascript")


app.include_router(passwords_router.router)
app.include_router(webauthn_router.router)
app.include_router(github_router.router)
app.include_router(analyze.router)
app.include_router(chat.router)
app.include_router(logs.router)
app.include_router(builds.router)
app.include_router(users.router)
app.include_router(tuning.router)
app.include_router(bootmod3_router.router)
