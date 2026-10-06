from __future__ import annotations

import datetime as dt
import re
import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.config import get_settings

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")


class RegisterIn(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError("username: 3-64 chars, letters/digits/._- only")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        min_len = get_settings().password_min_length
        if len(v) < min_len:
            raise ValueError(f"password must be at least {min_len} characters")
        if v.lower() == v or v.upper() == v or not any(c.isdigit() for c in v):
            raise ValueError("password needs upper, lower and a digit")
        return v


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=320, description="email or username")
    password: str = Field(min_length=1, max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class LogoutIn(RefreshIn):
    pass


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    username: str
    role: str
    status: str
    last_login_at: dt.datetime | None

    model_config = {"from_attributes": True}

    @field_validator("role", "status", mode="before")
    @classmethod
    def _enum_to_str(cls, v):
        return getattr(v, "value", v)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)

    @field_validator("new_password")
    @classmethod
    def _new_password(cls, v: str) -> str:
        return RegisterIn._password(v)  # same policy as registration


class SessionOut(BaseModel):
    id: str
    created_at: str | None
    expires_at: str | None
    user_agent: str
    client_ip: str
