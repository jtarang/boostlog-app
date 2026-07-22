from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.db import Base
from backend.ids import uuid7


class User(Base):
    __tablename__ = "users"
    # UUIDv7 (time-ordered) — non-enumerable external identity; also the JWT sub.
    id = Column(String(36), primary_key=True, default=uuid7, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    github_id = Column(String, unique=True, index=True, nullable=True)
    google_id = Column(String, unique=True, index=True, nullable=True)
    microsoft_id = Column(String, unique=True, index=True, nullable=True)
    discord_id = Column(String, unique=True, index=True, nullable=True)
    apple_id = Column(String, unique=True, index=True, nullable=True)
    settings_json = Column(Text, nullable=True)

    # Linked bootmod3 account. Tokens are Fernet-encrypted (see backend.crypto);
    # the password is never stored -- on token expiry the user re-links.
    bootmod3_tokens = Column(Text, nullable=True)
    bootmod3_email = Column(String, nullable=True)
    bootmod3_linked_at = Column(DateTime(timezone=True), nullable=True)
    subscription_tier = Column(String, default="free")
    ai_usages = relationship("AIUsage", back_populates="user")

    webauthn_id = Column(String, unique=True, index=True, nullable=True)

    password_reset_token = Column(String, unique=True, index=True, nullable=True)
    password_reset_expiry = Column(DateTime(timezone=True), nullable=True)

    datalogs = relationship("Datalog", back_populates="owner", cascade="all, delete-orphan")
    builds = relationship("Build", back_populates="owner", cascade="all, delete-orphan")
    credentials = relationship("UserCredential", back_populates="user", cascade="all, delete-orphan")
    payment_methods = relationship("PaymentMethod", back_populates="user", cascade="all, delete-orphan")
    subscription = relationship("UserSubscription", back_populates="user", uselist=False, cascade="all, delete-orphan")


class UserCredential(Base):
    __tablename__ = "user_credentials"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    credential_id = Column(String, unique=True, index=True, nullable=False)
    public_key = Column(String, nullable=False)
    sign_count = Column(Integer, default=0)
    transports = Column(String, nullable=True)
    name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="credentials")


class Build(Base):
    __tablename__ = "builds"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    vin = Column(String, nullable=True)
    vehicle_model = Column(String, nullable=True)
    customer_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner = relationship("User", back_populates="builds")
    datalogs = relationship("Datalog", back_populates="build", passive_deletes=True)


class Datalog(Base):
    __tablename__ = "datalogs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    build_id = Column(Integer, ForeignKey("builds.id", ondelete="SET NULL"), nullable=True)
    stored_filename = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    source_filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # When the log was actually recorded on the car, as reported by the source
    # (e.g. bootmod3's /getlogs metadata) -- distinct from uploaded_at, which is
    # always when it landed in boostLog. Null when the source gives no date.
    recorded_at = Column(DateTime(timezone=True), nullable=True)
    owner = relationship("User", back_populates="datalogs")
    build = relationship("Build", back_populates="datalogs")
    analyses = relationship("Analysis", back_populates="datalog", cascade="all, delete-orphan")
    chats = relationship("ChatHistory", back_populates="datalog", cascade="all, delete-orphan")


class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    datalog_id = Column(Integer, ForeignKey("datalogs.id"), nullable=False)
    model_used = Column(String, nullable=False)
    result_markdown = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    datalog = relationship("Datalog", back_populates="analyses")


class ChatHistory(Base):
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, index=True)
    datalog_id = Column(Integer, ForeignKey("datalogs.id"), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    datalog = relationship("Datalog", back_populates="chats")


class AIUsage(Base):
    __tablename__ = "ai_usage"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    tokens_used = Column(Integer, default=0)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    estimated_cost = Column(Float, default=0.0)
    model_used = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="ai_usages")


class SubscriptionTier(Base):
    __tablename__ = "subscription_tiers"

    name = Column(String, primary_key=True)  # e.g., 'free', 'pro'
    token_limit = Column(Integer, nullable=False)


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    stripe_payment_method_id = Column(String, unique=True, index=True, nullable=False)
    card_last_four = Column(String, nullable=False)
    card_brand = Column(String, nullable=False)  # e.g., 'visa', 'mastercard'
    exp_month = Column(Integer, nullable=False)
    exp_year = Column(Integer, nullable=False)
    is_default = Column(Integer, default=0)  # SQLite doesn't have bool
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="payment_methods")


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    stripe_customer_id = Column(String, unique=True, index=True, nullable=True)  # null until a real Stripe customer is created
    stripe_subscription_id = Column(String, unique=True, index=True, nullable=True)  # null if on free tier
    tier = Column(String, nullable=False, default="free")  # free, pro, tuner
    status = Column(String, default="inactive")  # inactive, active, past_due, cancelled
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Integer, default=0)  # SQLite bool
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="subscription")

