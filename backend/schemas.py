from typing import Optional

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


class LogRename(BaseModel):
    new_name: str


class BuildCreate(BaseModel):
    name: str
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class BuildUpdate(BaseModel):
    name: Optional[str] = None
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    settings_json: Optional[str] = None


class LogMove(BaseModel):
    build_id: Optional[int] = None


class PasswordResetRequest(BaseModel):
    username_or_email: str


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class UsernameUpdate(BaseModel):
    new_username: str


class PasskeyRename(BaseModel):
    name: str


class SubscriptionUpgrade(BaseModel):
    tier: str


class Bootmod3Link(BaseModel):
    username: str
    password: str


class Bootmod3Import(BaseModel):
    log_id: str
    build_id: Optional[int] = None


class StripePaymentIntent(BaseModel):
    tier: str
    payment_method_id: Optional[str] = None
