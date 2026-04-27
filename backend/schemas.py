from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    password: str


class LogRename(BaseModel):
    new_name: str


class ProjectCreate(BaseModel):
    name: str
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    vin: Optional[str] = None
    vehicle_model: Optional[str] = None
    customer_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    settings_json: Optional[str] = None


class LogMove(BaseModel):
    project_id: Optional[int] = None


class PasswordResetRequest(BaseModel):
    username_or_email: str


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class UsernameUpdate(BaseModel):
    new_username: str


class PasskeyRename(BaseModel):
    name: str
