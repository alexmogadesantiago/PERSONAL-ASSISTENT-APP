"""Encryption at rest for credential secrets (Fernet / AES-128-CBC + HMAC).

The master key comes from `AC_CREDENTIAL_ENCRYPTION_KEY` (env / secret store) and
is NEVER written to the database. Without it, ciphertext in `credentials.encrypted_data`
is unreadable. Key rotation: set `AC_CREDENTIAL_ENCRYPTION_KEYS` to a comma list
(newest first) and Fernet's MultiFernet will decrypt with any, encrypt with the first.
"""
from __future__ import annotations

import functools
import json
import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import get_settings

_PLACEHOLDER = ("CAMBIA", "PEGA_AQUI", "PLACEHOLDER", "CHANGE_ME", "")


class CipherNotConfigured(RuntimeError):
    """Raised when a credential operation needs the master key but it is unset."""


class DecryptionError(RuntimeError):
    """Ciphertext could not be decrypted with the configured key(s)."""


def _keys() -> list[str]:
    extra = os.getenv("AC_CREDENTIAL_ENCRYPTION_KEYS", "")
    keys = [k.strip() for k in extra.split(",") if k.strip()]
    primary = get_settings().credential_encryption_key.strip()
    if primary and primary not in keys:
        keys.insert(0, primary)
    return [k for k in keys if k and not any(p and p in k for p in _PLACEHOLDER)]


@functools.lru_cache(maxsize=1)
def _fernet() -> MultiFernet | None:
    keys = _keys()
    if not keys:
        return None
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except (ValueError, TypeError) as exc:
        raise CipherNotConfigured(f"invalid AC_CREDENTIAL_ENCRYPTION_KEY: {exc}") from exc


def is_configured() -> bool:
    return _fernet() is not None


def reset_cache() -> None:
    """Test helper: forget the memoised key (settings/env changed)."""
    _fernet.cache_clear()


def encrypt_secret(payload: dict) -> bytes:
    f = _fernet()
    if f is None:
        raise CipherNotConfigured("AC_CREDENTIAL_ENCRYPTION_KEY is not set")
    return f.encrypt(json.dumps(payload, separators=(",", ":")).encode())


def decrypt_secret(blob: bytes) -> dict:
    f = _fernet()
    if f is None:
        raise CipherNotConfigured("AC_CREDENTIAL_ENCRYPTION_KEY is not set")
    try:
        return json.loads(f.decrypt(blob).decode())
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError("could not decrypt credential with the configured key") from exc


def generate_key() -> str:
    return Fernet.generate_key().decode()


def seal(payload: dict) -> str:
    """Opaque, authenticated, timestamped token (URL-safe). Used for the OAuth
    `state`: it carries the PKCE verifier through the browser without exposing
    it, and cannot be forged or replayed after `open_sealed`'s TTL."""
    return encrypt_secret(payload).decode()


def open_sealed(token: str, *, ttl_seconds: int) -> dict:
    f = _fernet()
    if f is None:
        raise CipherNotConfigured("AC_CREDENTIAL_ENCRYPTION_KEY is not set")
    try:
        return json.loads(f.decrypt(token.encode(), ttl=ttl_seconds).decode())
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError("invalid or expired token") from exc
