import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

os.makedirs("data", exist_ok=True)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/boostlog.db")

if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {}
engine_kwargs = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    # Defaults (pool_size=5, max_overflow=10) exhaust under moderate concurrent
    # traffic — the AI analyze/chat/tuning-recommend endpoints hold their DB
    # session open for the whole LLM call (several seconds), so a handful of
    # concurrent AI requests can pin every pooled connection and start timing
    # out unrelated requests (e.g. get_current_user on a plain page load).
    # Overridable via env so this can be tuned in prod without a redeploy.
    engine_kwargs = {
        "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
        # Recycle connections RDS/the network may have silently dropped while
        # idle, and cheaply verify liveness before handing one out.
        "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "1800")),
        "pool_pre_ping": True,
    }

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
