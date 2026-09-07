"""Provider-agnostic AI layer.

    Automation -> AIService -> AIProvider -> NVIDIA NIM | OpenRouter | Gemini

Nothing outside this package imports a provider or a vendor SDK. Callers use
``AIService``; which provider actually answers is configuration, changed from
the web panel with no code edit, no ``.env`` edit and no redeploy.
"""
from app.services.ai.base import (
    AIProvider,
    AIResponse,
    Message,
    ModelInfo,
    ResponseFormat,
)
from app.services.ai.errors import (
    AIAuthError,
    AIBadRequest,
    AIError,
    AIInvalidResponse,
    AINotConfigured,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
)
from app.services.ai.gemini import GeminiProvider
from app.services.ai.openai_compatible import NvidiaNimProvider, OpenRouterProvider
from app.services.ai.service import AIHealth, AIService, GenerationResult, reset_caches

__all__ = [
    "AIAuthError",
    "AIBadRequest",
    "AIError",
    "AIHealth",
    "AIInvalidResponse",
    "AINotConfigured",
    "AIProvider",
    "AIRateLimited",
    "AIResponse",
    "AIService",
    "AITimeout",
    "AIUnavailable",
    "GeminiProvider",
    "GenerationResult",
    "Message",
    "ModelInfo",
    "NvidiaNimProvider",
    "OpenRouterProvider",
    "ResponseFormat",
    "reset_caches",
]
