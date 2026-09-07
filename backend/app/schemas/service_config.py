from __future__ import annotations

from pydantic import BaseModel, Field


class ServiceConfigOut(BaseModel):
    """Browser-safe view of one service configuration.

    Never carries the secret itself - only whether one is stored and its last
    few characters, so the panel can show "…a3f9" without the value ever
    leaving the backend.
    """

    service: str
    label: str
    #: infra | ai | internal - the panel groups cards by this
    category: str = "infra"
    configured: bool
    enabled: bool
    #: database | environment | none - tells the user where the value came from
    source: str
    base_url: str
    requires_url: bool
    requires_secret: bool
    secret_configured: bool
    secret_hint: str
    missing: list[str]
    last_tested_at: str | None = None
    last_test_ok: bool | None = None
    last_test_detail: str = ""


class ServiceConfigListOut(BaseModel):
    data: list[ServiceConfigOut]


class ServiceConfigUpdate(BaseModel):
    """Partial update. Omitted fields are left untouched.

    `secret=None` keeps the stored secret (so a URL edit does not force the user
    to re-type the key); `clear_secret=true` removes it.
    """

    base_url: str | None = Field(default=None, max_length=500)
    secret: str | None = Field(default=None, max_length=4096)
    clear_secret: bool = False
    enabled: bool | None = None


class ServiceTestResult(BaseModel):
    service: str
    ok: bool
    status: str
    detail: str
    latency_ms: float | None = None
