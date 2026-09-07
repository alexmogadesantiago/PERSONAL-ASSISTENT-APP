"""Profile CRUD. Every operation is scoped to one user; a caller can never see
or touch another user's rows (unknown ids look identical to other-user ids: 404).

`configuration` is an open JSON object. `PROFILE_DIMENSIONS` documents the
personalisation dimensions the product uses, but unknown keys are accepted so
new categories can be added without a schema change or migration.
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import EventSeverity, Profile
from app.services import audit
from app.services import profile_catalog

PROFILE_DIMENSIONS: tuple[str, ...] = (
    "formacion",
    "sector",
    "objetivo_profesional",
    "ubicacion",
    "modalidad",
    # The language the automations write in. It used to live only in the static
    # file the workflows read, so the picker could not set it.
    "idioma",
    "experiencia_nivel",
    "intereses",
    "preferencias_laborales",
    "preferencias_noticias",
    "marca_personal",
    "automatizaciones",
)


#: What the product considers a *usable* profile (Phase 5).
#:
#: Each entry is (label, accepted configuration keys). A requirement is met when
#: at least one of its keys carries a non-empty value, so a panel form that
#: writes literal Spanish field names and the older `modules.json` dimension
#: names both satisfy it without a migration.
#:
#: The profile must be more than an existing row: an empty `configuration` is
#: explicitly NOT configured.
REQUIRED_PROFILE_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("profesion", ("profesion", "sector", "objetivo_profesional", "formacion")),
    ("ubicacion", ("ubicacion", "ubicacion_laboral", "localizacion")),
    ("intereses", ("intereses", "temas", "topics")),
    (
        "preferencias",
        (
            "preferencias",
            "preferencias_laborales",
            "preferencias_noticias",
            "modalidad",
            "automatizaciones",
        ),
    ),
)


def _has_value(configuration: dict, key: str) -> bool:
    """A key counts only when it holds real content.

    Empty strings, empty lists and lists of blank strings are treated as unset -
    the UI writes `[]` for an untouched multi-select, and that must not make a
    profile look complete.
    """
    if key not in configuration:
        return False
    value = configuration[key]
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set)):
        return any(str(v).strip() for v in value)
    if isinstance(value, dict):
        return bool(value)
    return True


def profile_completeness(profile: Profile) -> dict:
    """Report whether one profile carries the minimum data the automations need.

    Returned shape is stable and safe to expose: it names the *missing fields*,
    never their values.
    """
    configuration = profile.configuration or {}
    filled: list[str] = []
    missing: list[str] = []
    for label, keys in REQUIRED_PROFILE_FIELDS:
        (filled if any(_has_value(configuration, k) for k in keys) else missing).append(label)

    if not (profile.name or "").strip():
        missing.insert(0, "name")
    if not profile.is_active:
        missing.append("active")

    total = len(REQUIRED_PROFILE_FIELDS)
    return {
        "profile_id": str(profile.id),
        "name": profile.name,
        "complete": not missing,
        "filled": filled,
        "missing": missing,
        "score": round(len(filled) / total, 2) if total else 1.0,
    }


def completeness_for_user(db: Session, user_id: uuid.UUID) -> dict:
    """Completeness of the user's primary profile (or the best one they have)."""
    rows = list_profiles(db, user_id)
    if not rows:
        return {
            "configured": False,
            "profile_count": 0,
            "detail": "no profile created yet",
            "best": None,
        }
    reports = [profile_completeness(r) for r in rows]
    best = max(reports, key=lambda r: (r["complete"], r["score"]))
    return {
        "configured": bool(best["complete"]),
        "profile_count": len(rows),
        "detail": (
            f"profile '{best['name']}' is complete"
            if best["complete"]
            else "missing: " + ", ".join(best["missing"])
        ),
        "best": best,
    }


def any_complete_profile(db: Session) -> dict:
    """Instance-wide answer for the health dashboard.

    Deliberately aggregate: it says *whether* a usable profile exists and how
    many profiles there are, and never returns anyone's profile content, so the
    monitoring endpoint leaks nothing personal.
    """
    total = db.scalar(select(func.count()).select_from(Profile)) or 0
    if total == 0:
        return {"configured": False, "profile_count": 0, "detail": "no profile created yet"}

    complete = 0
    shortest_missing: list[str] | None = None
    for row in db.scalars(select(Profile).where(Profile.is_active.is_(True))):
        report = profile_completeness(row)
        if report["complete"]:
            complete += 1
        elif shortest_missing is None or len(report["missing"]) < len(shortest_missing):
            shortest_missing = report["missing"]

    if complete:
        return {
            "configured": True,
            "profile_count": total,
            "complete_profiles": complete,
            "detail": f"{complete} complete profile(s)",
        }
    return {
        "configured": False,
        "profile_count": total,
        "complete_profiles": 0,
        "detail": "profile incomplete, missing: " + ", ".join(shortest_missing or ["configuration"]),
    }


class ProfileError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NotFound(ProfileError):
    def __init__(self) -> None:
        super().__init__("profile not found", 404)


def _get_owned(db: Session, user_id: uuid.UUID, profile_id: uuid.UUID) -> Profile:
    row = db.scalar(
        select(Profile).where(Profile.id == profile_id, Profile.user_id == user_id)
    )
    if row is None:
        raise NotFound()
    return row


def list_profiles(db: Session, user_id: uuid.UUID) -> list[Profile]:
    return list(
        db.scalars(
            select(Profile)
            .where(Profile.user_id == user_id)
            .order_by(Profile.is_primary.desc(), Profile.created_at.asc())
        )
    )


def get_profile(db: Session, user_id: uuid.UUID, profile_id: uuid.UUID) -> Profile:
    return _get_owned(db, user_id, profile_id)


def create_profile(
    db: Session,
    user_id: uuid.UUID,
    *,
    name: str,
    description: str = "",
    configuration: dict | None = None,
    make_primary: bool = False,
    correlation_id: str | None = None,
) -> Profile:
    name = name.strip()
    if not name:
        raise ProfileError("name is required")
    dup = db.scalar(
        select(Profile).where(Profile.user_id == user_id, func.lower(Profile.name) == name.lower())
    )
    if dup is not None:
        raise ProfileError("a profile with that name already exists", 409)

    first = db.scalar(select(func.count()).select_from(Profile).where(Profile.user_id == user_id)) == 0
    profile = Profile(
        user_id=user_id,
        name=name,
        description=(description or "").strip(),
        # Store the catalogue's vocabulary, whoever wrote it: the visual picker
        # already speaks it, and this converts an API caller (or an older
        # hand-written profile being re-saved) without losing anything it does
        # not recognise.
        configuration=profile_catalog.normalise_configuration(configuration),
        is_active=True,
        is_primary=bool(make_primary or first),
    )
    db.add(profile)
    db.flush()
    if profile.is_primary:
        _clear_other_primary(db, user_id, keep=profile.id)
    audit.record(
        db,
        type="profile.create",
        message=f"profile created: {name}",
        actor_id=user_id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    db.refresh(profile)
    return profile


def update_profile(
    db: Session,
    user_id: uuid.UUID,
    profile_id: uuid.UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    configuration: dict | None = None,
    is_active: bool | None = None,
    correlation_id: str | None = None,
) -> Profile:
    profile = _get_owned(db, user_id, profile_id)
    if name is not None:
        name = name.strip()
        if not name:
            raise ProfileError("name cannot be empty")
        clash = db.scalar(
            select(Profile).where(
                Profile.user_id == user_id,
                func.lower(Profile.name) == name.lower(),
                Profile.id != profile_id,
            )
        )
        if clash is not None:
            raise ProfileError("a profile with that name already exists", 409)
        profile.name = name
    if description is not None:
        profile.description = description.strip()
    if configuration is not None:
        profile.configuration = profile_catalog.normalise_configuration(configuration)
    if is_active is not None:
        if not is_active and profile.is_primary:
            raise ProfileError("cannot deactivate the primary profile", 409)
        profile.is_active = is_active
    audit.record(
        db,
        type="profile.update",
        message=f"profile updated: {profile.name}",
        actor_id=user_id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    db.refresh(profile)
    return profile


def duplicate_profile(
    db: Session,
    user_id: uuid.UUID,
    profile_id: uuid.UUID,
    *,
    new_name: str | None = None,
    correlation_id: str | None = None,
) -> Profile:
    src = _get_owned(db, user_id, profile_id)
    name = (new_name or f"{src.name} (copia)").strip()
    n = 2
    while db.scalar(
        select(Profile).where(Profile.user_id == user_id, func.lower(Profile.name) == name.lower())
    ) is not None:
        name = f"{src.name} (copia {n})"
        n += 1
    clone = Profile(
        user_id=user_id,
        name=name,
        description=src.description,
        configuration=profile_catalog.normalise_configuration(src.configuration),
        is_active=True,
        is_primary=False,
    )
    db.add(clone)
    audit.record(
        db,
        type="profile.duplicate",
        message=f"profile duplicated from {src.name} -> {name}",
        actor_id=user_id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    db.refresh(clone)
    return clone


def delete_profile(
    db: Session, user_id: uuid.UUID, profile_id: uuid.UUID, *, correlation_id: str | None = None
) -> None:
    profile = _get_owned(db, user_id, profile_id)
    was_primary = profile.is_primary
    db.delete(profile)
    db.flush()
    if was_primary:
        # promote the oldest remaining profile so the user always has a primary
        nxt = db.scalar(
            select(Profile)
            .where(Profile.user_id == user_id)
            .order_by(Profile.created_at.asc())
        )
        if nxt is not None:
            nxt.is_primary = True
    audit.record(
        db,
        type="profile.delete",
        message=f"profile deleted: {profile.name}",
        severity=EventSeverity.warning,
        actor_id=user_id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()


def set_primary(
    db: Session, user_id: uuid.UUID, profile_id: uuid.UUID, *, correlation_id: str | None = None
) -> Profile:
    profile = _get_owned(db, user_id, profile_id)
    if not profile.is_active:
        raise ProfileError("activate the profile before making it primary", 409)
    _clear_other_primary(db, user_id, keep=profile.id)
    profile.is_primary = True
    audit.record(
        db,
        type="profile.set_primary",
        message=f"primary profile set: {profile.name}",
        actor_id=user_id,
        correlation_id=correlation_id,
        commit=False,
    )
    db.commit()
    db.refresh(profile)
    return profile


def _clear_other_primary(db: Session, user_id: uuid.UUID, *, keep: uuid.UUID) -> None:
    for row in db.scalars(
        select(Profile).where(
            Profile.user_id == user_id, Profile.is_primary.is_(True), Profile.id != keep
        )
    ):
        row.is_primary = False
    db.flush()


def effective_profile(db: Session, user_id: uuid.UUID) -> Profile | None:
    """The profile the automations should run with for this user.

    Primary first, then any active one, then the oldest. A user with no profile
    at all gets None - the caller decides whether that is an error or simply an
    installation nobody has configured yet.
    """
    rows = list_profiles(db, user_id)
    if not rows:
        return None
    for row in rows:
        if row.is_primary:
            return row
    for row in rows:
        if row.is_active:
            return row
    return rows[0]
