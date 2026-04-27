from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.db import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    github_id = Column(String, unique=True, index=True, nullable=True)
    settings_json = Column(Text, nullable=True)

    webauthn_id = Column(String, unique=True, index=True, nullable=True)

    password_reset_token = Column(String, unique=True, index=True, nullable=True)
    password_reset_expiry = Column(DateTime(timezone=True), nullable=True)

    datalogs = relationship("Datalog", back_populates="owner", cascade="all, delete-orphan")
    builds = relationship("Build", back_populates="owner", cascade="all, delete-orphan")
    credentials = relationship("UserCredential", back_populates="user", cascade="all, delete-orphan")


class UserCredential(Base):
    __tablename__ = "user_credentials"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    build_id = Column(Integer, ForeignKey("builds.id", ondelete="SET NULL"), nullable=True)
    stored_filename = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    source_filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner = relationship("User", back_populates="datalogs")
    build = relationship("Build", back_populates="datalogs")
    analyses = relationship("Analysis", back_populates="datalog", cascade="all, delete-orphan")


class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    datalog_id = Column(Integer, ForeignKey("datalogs.id"), nullable=False)
    model_used = Column(String, nullable=False)
    result_markdown = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    datalog = relationship("Datalog", back_populates="analyses")
