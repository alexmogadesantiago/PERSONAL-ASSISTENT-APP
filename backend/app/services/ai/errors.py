"""Failure vocabulary shared by every AI provider.

The distinction that matters is ``retryable``: it is what decides whether the
fallback provider is allowed to see the same request.

Retryable  - the provider could not answer *this time* (timeout, 429, 5xx,
             connection refused). Another provider may well succeed, so the
             fallback is worth trying.
Not retryable - the request or the credential is wrong (400, 401, 403) or the
             answer was unusable. Replaying it against a second provider would
             just burn a second quota and return the same class of failure, so
             it is raised straight to the caller.
"""
from __future__ import annotations


class AIError(Exception):
    """Base class. ``retryable`` drives the fallback decision."""

    retryable = False

    def __init__(self, message: str, *, provider: str = "", status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.status_code = status_code

    def __str__(self) -> str:  # keep provider context in logs and API details
        return f"{self.provider}: {self.message}" if self.provider else self.message


class AINotConfigured(AIError):
    """No provider (or no credential for the selected provider) is configured."""


class AIAuthError(AIError):
    """HTTP 401/403 - the provider refused the credential. Never retried."""


class AIBadRequest(AIError):
    """HTTP 400 - the request itself is wrong. Never retried."""


class AIInvalidResponse(AIError):
    """The provider answered, but not with something usable (bad JSON, no text).

    Deliberately NOT retryable: a malformed answer is usually a prompt/schema
    problem, and replaying it elsewhere hides the bug behind a second bill.
    """


class AIRateLimited(AIError):
    """HTTP 429."""

    retryable = True


class AIUnavailable(AIError):
    """HTTP 5xx, DNS failure, connection refused."""

    retryable = True


class AITimeout(AIUnavailable):
    """The provider did not answer inside the configured timeout."""

    retryable = True


__all__ = [
    "AIAuthError",
    "AIBadRequest",
    "AIError",
    "AIInvalidResponse",
    "AINotConfigured",
    "AIRateLimited",
    "AITimeout",
    "AIUnavailable",
]
