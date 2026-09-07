"""Operator CLI for the things that must never be reachable over HTTP.

Today that is exactly one thing: who is an administrator.

The platform bootstraps its first account as admin (`services.auth.register_user`)
and offers no way to change a role afterwards - deliberately, because an
endpoint that grants admin is an endpoint that can be abused. But "the first
account" is a one-shot rule: run the smoke test against a fresh deployment, or
register twice while setting things up, and the human who owns the platform can
end up a plain user with no way back.

This module is that way back. It runs where the database credentials already
are - a Render shell, a `docker compose exec`, a local checkout - so holding the
credentials *is* the authorisation. Nothing here is imported by the API.

    python -m app.manage list-users
    python -m app.manage promote-admin alexmogadesantiago
    python -m app.manage demote-admin someone-else

Every change is written to the audit log as `auth.role.change`, and the last
administrator cannot be demoted: a platform with no admin can only be repaired
from a shell, which is exactly the situation this module exists to avoid.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import EventSeverity, User, UserRole
from app.services import audit


def _find(db: Session, identifier: str) -> User | None:
    """By username or email, case-insensitively - the same way login matches."""
    needle = identifier.strip().lower()
    return db.scalar(
        select(User).where(
            (func.lower(User.username) == needle) | (func.lower(User.email) == needle)
        )
    )


def _admin_count(db: Session) -> int:
    return (
        db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.admin)) or 0
    )


def _describe(user: User) -> str:
    return f"{user.username} <{user.email}> role={user.role.value} status={user.status.value}"


def _set_role(db: Session, identifier: str, role: UserRole) -> int:
    user = _find(db, identifier)
    if user is None:
        print(f"no user matches '{identifier}' (try `list-users`)", file=sys.stderr)
        return 1

    if user.role == role:
        # Idempotent: re-running a promotion is a no-op, not an error, so it is
        # safe to put in a runbook.
        print(f"unchanged: {_describe(user)}")
        return 0

    if role is UserRole.user and _admin_count(db) <= 1:
        print(
            f"refusing to demote {user.username}: it is the only administrator left. "
            "Promote someone else first.",
            file=sys.stderr,
        )
        return 2

    previous = user.role
    user.role = role
    audit.record(
        db,
        type="auth.role.change",
        message=f"role changed by CLI: {user.username} {previous.value} -> {role.value}",
        severity=EventSeverity.warning,
        actor_id=user.id,
        meta={"username": user.username, "from": previous.value, "to": role.value, "via": "cli"},
        commit=False,
    )
    db.commit()
    db.refresh(user)
    print(f"updated: {_describe(user)}")
    return 0


def cmd_promote(db: Session, args: argparse.Namespace) -> int:
    return _set_role(db, args.user, UserRole.admin)


def cmd_demote(db: Session, args: argparse.Namespace) -> int:
    return _set_role(db, args.user, UserRole.user)


def cmd_list(db: Session, args: argparse.Namespace) -> int:
    rows = db.scalars(select(User).order_by(User.created_at)).all()
    if not rows:
        print("no users yet - register the first account, which becomes admin")
        return 0
    for user in rows:
        if args.admins_only and user.role != UserRole.admin:
            continue
        print(_describe(user))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.manage",
        description="Automation Center operator commands (roles only, for now).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    promote = sub.add_parser("promote-admin", help="give a user the admin role")
    promote.add_argument("user", help="username or email")
    promote.set_defaults(func=cmd_promote)

    demote = sub.add_parser("demote-admin", help="take the admin role away")
    demote.add_argument("user", help="username or email")
    demote.set_defaults(func=cmd_demote)

    listing = sub.add_parser("list-users", help="show every account and its role")
    listing.add_argument("--admins-only", action="store_true")
    listing.set_defaults(func=cmd_list)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    db = SessionLocal()
    try:
        return args.func(db, args)
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    sys.exit(main())
