
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import Profile, User
from app.schemas.profile import (
    ProfileCatalogOut,
    ProfileCompletenessOut,
    ProfileCreate,
    ProfileDimensionsOut,
    ProfileDuplicate,
    ProfileOut,
    ProfileRuntimeOut,
    ProfileUpdate,
)
from app.services import profile_catalog
from app.services import profile_runtime
from app.services import profiles as svc
from app.services.ai import token as ai_token

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _bearer_token(request: Request) -> str:
    """The raw bearer token on this request, if there is one."""
    scheme, _, credentials = (request.headers.get("authorization") or "").partition(" ")
    return credentials if scheme.lower() == "bearer" else ""


def _cid(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


def _guard(fn):
    try:
        return fn()
    except svc.ProfileError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/dimensions", response_model=ProfileDimensionsOut)
def dimensions() -> ProfileDimensionsOut:
    return ProfileDimensionsOut(
        dimensions=list(svc.PROFILE_DIMENSIONS),
        note="configuration is an open JSON object; unknown keys are accepted",
    )


@router.get("/catalog", response_model=ProfileCatalogOut)
def catalog() -> ProfileCatalogOut:
    """The pickable options the personalisation UI renders.

    Public (no session): it is a static vocabulary, contains nothing about any
    user, and the login screen has no reason to hold it back.
    """
    return ProfileCatalogOut.model_validate(profile_catalog.as_dict())


@router.get("/runtime", response_model=ProfileRuntimeOut)
def runtime_profile(
    request: Request,
    profile_id: str | None = None,
    db: Session = Depends(get_db),
    x_ac_service_token: str | None = Header(default=None, alias="X-AC-Service-Token"),
) -> ProfileRuntimeOut:
    """The profile the automations run with, derived from Postgres.

    This is what replaced `/files/config/user_profile.json`. There is no file to
    keep in step any more: n8n asks for the profile when it runs, so a change
    saved in the picker applies to the very next execution.

    Two callers, two rules:

    * a signed-in user gets their own profile, and `profile_id` must be one they
      own - asking for someone else's is a 404, never another tenant's data;
    * an automation presenting the service token must name a `profile_id`. The
      token belongs to the installation, not to a person, so it is never allowed
      to mean "whoever happens to be first".

    `profile_id` is taken as text and parsed here rather than annotated as a
    UUID, for one reason: n8n builds the query string from `$env.AC_PROFILE_ID`,
    and when that variable is unset the URL ends in a bare `?profile_id=`. An
    empty value is not the same as an absent one for FastAPI, so the request
    died at validation with a 422 about UUID lengths - hiding the 400 below,
    which is the message that actually tells the operator what to do. Empty now
    means "not named"; a non-empty value that is not a UUID is still refused.
    """
    requested: uuid.UUID | None = None
    if profile_id is not None and profile_id.strip():
        try:
            requested = uuid.UUID(profile_id.strip())
        except ValueError:
            raise HTTPException(
                status_code=422, detail="profile_id must be a UUID"
            ) from None

    presented = (x_ac_service_token or "").strip()
    if presented and ai_token.verify(db, presented):
        if requested is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "an automation must name the profile_id it wants "
                    "(set AC_PROFILE_ID for n8n)"
                ),
            )
        profile = db.get(Profile, requested)
        if profile is None:
            raise HTTPException(status_code=404, detail="profile not found")
    else:
        user = get_current_user(
            creds=HTTPAuthorizationCredentials(
                scheme="Bearer", credentials=_bearer_token(request)
            )
            if _bearer_token(request)
            else None,
            db=db,
        )
        if requested is not None:
            profile = _guard(lambda: svc.get_profile(db, user.id, requested))
        else:
            profile = svc.effective_profile(db, user.id)
            if profile is None:
                raise HTTPException(status_code=404, detail="this user has no profile yet")

    return ProfileRuntimeOut(
        profile_id=str(profile.id),
        name=profile.name,
        updated_at=profile.updated_at.isoformat() if profile.updated_at else "",
        profile=profile_runtime.build(profile.configuration),
    )


@router.get("/completeness", response_model=ProfileCompletenessOut)
def completeness(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProfileCompletenessOut:
    """Is the caller profile usable by the automations?

    Drives the setup wizard and the PROFILE tile on /monitoring. A profile row
    existing is not enough - the minimum fields must carry real values.
    """
    report = svc.completeness_for_user(db, user.id)
    return ProfileCompletenessOut(
        configured=report["configured"],
        profile_count=report["profile_count"],
        detail=report["detail"],
        required_fields=[label for label, _ in svc.REQUIRED_PROFILE_FIELDS],
        best=report["best"],
    )


@router.get("", response_model=list[ProfileOut])
def list_mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.list_profiles(db, user.id)


@router.post("", response_model=ProfileOut, status_code=201)
def create(
    request: Request,
    body: ProfileCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(
        lambda: svc.create_profile(
            db,
            user.id,
            name=body.name,
            description=body.description,
            configuration=body.configuration,
            make_primary=body.make_primary,
            correlation_id=_cid(request),
        )
    )


@router.get("/{profile_id}", response_model=ProfileOut)
def get_one(
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(lambda: svc.get_profile(db, user.id, profile_id))


@router.patch("/{profile_id}", response_model=ProfileOut)
def update(
    request: Request,
    profile_id: uuid.UUID,
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(
        lambda: svc.update_profile(
            db,
            user.id,
            profile_id,
            name=body.name,
            description=body.description,
            configuration=body.configuration,
            is_active=body.is_active,
            correlation_id=_cid(request),
        )
    )


@router.post("/{profile_id}/duplicate", response_model=ProfileOut, status_code=201)
def duplicate(
    request: Request,
    profile_id: uuid.UUID,
    body: ProfileDuplicate | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(
        lambda: svc.duplicate_profile(
            db, user.id, profile_id, new_name=(body.name if body else None), correlation_id=_cid(request)
        )
    )


@router.delete("/{profile_id}", status_code=200)
def delete(
    request: Request,
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _guard(lambda: svc.delete_profile(db, user.id, profile_id, correlation_id=_cid(request)))
    return {"deleted": True}


@router.post("/{profile_id}/activate", response_model=ProfileOut)
def activate(
    request: Request,
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(
        lambda: svc.update_profile(
            db, user.id, profile_id, is_active=True, correlation_id=_cid(request)
        )
    )


@router.post("/{profile_id}/deactivate", response_model=ProfileOut)
def deactivate(
    request: Request,
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(
        lambda: svc.update_profile(
            db, user.id, profile_id, is_active=False, correlation_id=_cid(request)
        )
    )


@router.post("/{profile_id}/primary", response_model=ProfileOut)
def make_primary(
    request: Request,
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _guard(lambda: svc.set_primary(db, user.id, profile_id, correlation_id=_cid(request)))
