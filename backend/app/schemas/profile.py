from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, Field


class ProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    configuration: dict = Field(default_factory=dict)
    make_primary: bool = False


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    configuration: dict | None = None
    is_active: bool | None = None


class ProfileDuplicate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


class ProfileOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str
    configuration: dict
    is_primary: bool
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime

    model_config = {"from_attributes": True}


class ProfileDimensionsOut(BaseModel):
    dimensions: list[str]
    note: str


class ProfileCompletenessReport(BaseModel):
    profile_id: str
    name: str
    complete: bool
    filled: list[str]
    missing: list[str]
    score: float


class ProfileCompletenessOut(BaseModel):
    """Whether the caller has a profile the automations can actually use."""

    configured: bool
    profile_count: int
    detail: str
    #: the required fields, so the UI can render the checklist without
    #: hard-coding a copy of the backend rule
    required_fields: list[str]
    best: ProfileCompletenessReport | None = None


class CatalogOptionOut(BaseModel):
    id: str
    label: str


class CatalogFieldOut(BaseModel):
    key: str
    #: where this field writes inside `configuration`
    path: list[str]
    label: str
    #: multi | single | scale | toggle | text
    kind: str
    hint: str = ""
    options: list[CatalogOptionOut] = []
    #: selecting this option id reveals the free-text field below
    free_text_trigger: str = ""
    free_text_path: list[str] = []
    free_text_label: str = ""


class CatalogSectionOut(BaseModel):
    key: str
    title: str
    question: str
    description: str = ""
    fields: list[CatalogFieldOut]


class ProfileCatalogOut(BaseModel):
    """Everything the visual profile builder needs to render itself.

    Serving this from the backend is what keeps one vocabulary: adding a sector
    or an interest is a change here, and the panel picks it up with no frontend
    release.
    """

    sections: list[CatalogSectionOut]
    #: the sections completeness actually grades, so the UI shows the backend's
    #: progress rule rather than inventing its own
    required_sections: list[str]


class ProfileRuntimeOut(BaseModel):
    """The profile as an automation consumes it.

    `profile` is the derived runtime shape (see `services.profile_runtime`); it
    carries no credential and no personal identifier beyond what the user chose.
    """

    profile_id: str
    name: str
    updated_at: str
    profile: dict
