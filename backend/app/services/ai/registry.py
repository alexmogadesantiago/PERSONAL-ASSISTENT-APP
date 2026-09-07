"""The providers this platform knows how to talk to.

Order matters: :data:`PROVIDER_IDS` is the preference order used when nobody has
chosen a provider yet, so a fresh install with only an NVIDIA key selects NVIDIA
NIM, and an existing install with only ``GEMINI_API_KEY`` keeps using Gemini.

The model lists here are a *fallback*, used only when the provider's own
``/models`` endpoint cannot be reached. The panel labels them ``catalog`` so a
stale entry is visibly stale rather than silently wrong.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.ai.base import AIProvider
from app.services.ai.gemini import GeminiProvider
from app.services.ai.openai_compatible import NvidiaNimProvider, OpenRouterProvider

NVIDIA_NIM = NvidiaNimProvider.id
OPENROUTER = OpenRouterProvider.id
GEMINI = GeminiProvider.id

#: preference order - also the order the panel renders
PROVIDER_IDS: tuple[str, ...] = (NVIDIA_NIM, OPENROUTER, GEMINI)


@dataclass(frozen=True)
class ProviderMeta:
    id: str
    label: str
    tagline: str
    recommended: bool
    #: key of the ``service_configs`` row holding this provider's credential
    service_key: str
    cls: type[AIProvider]
    default_base_url: str
    default_model: str
    api_style: str
    key_help: str
    console_url: str
    #: last-resort list when the provider's /models call fails
    catalog_models: tuple[str, ...]


PROVIDERS: dict[str, ProviderMeta] = {
    NVIDIA_NIM: ProviderMeta(
        id=NVIDIA_NIM,
        label="NVIDIA NIM",
        tagline="Recommended. High-performance inference, OpenAI-compatible.",
        recommended=True,
        service_key="nvidia_nim",
        cls=NvidiaNimProvider,
        default_base_url=NvidiaNimProvider.default_base_url,
        default_model=NvidiaNimProvider.default_model,
        api_style="openai",
        key_help="build.nvidia.com - open a model and use Get API Key (nvapi-...).",
        console_url="https://build.nvidia.com/",
        # Verified live against integrate.api.nvidia.com: these answer
        # /chat/completions. Do not add an entry that has only been seen in
        # `GET /models` - that endpoint lists models an account cannot invoke.
        catalog_models=(
            "nvidia/nemotron-3-super-120b-a12b",
            "nvidia/nemotron-3.5-lightning-30b-a3b",
            "openai/gpt-oss-20b",
        ),
    ),
    OPENROUTER: ProviderMeta(
        id=OPENROUTER,
        label="OpenRouter",
        tagline="Many models behind one OpenAI-compatible endpoint.",
        recommended=False,
        service_key="openrouter",
        cls=OpenRouterProvider,
        default_base_url=OpenRouterProvider.default_base_url,
        default_model=OpenRouterProvider.default_model,
        api_style="openai",
        key_help="openrouter.ai - Keys - Create key (sk-or-...).",
        console_url="https://openrouter.ai/keys",
        catalog_models=(
            "meta-llama/llama-3.3-70b-instruct",
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-haiku",
            "google/gemini-2.0-flash-001",
            "mistralai/mistral-small",
        ),
    ),
    GEMINI: ProviderMeta(
        id=GEMINI,
        label="Gemini",
        tagline="Google AI. Optional - kept for existing installations.",
        recommended=False,
        service_key="gemini",
        cls=GeminiProvider,
        default_base_url=GeminiProvider.default_base_url,
        default_model=GeminiProvider.default_model,
        api_style="gemini",
        key_help="Google AI Studio - Get API key.",
        console_url="https://aistudio.google.com/apikey",
        catalog_models=(
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
        ),
    ),
}

#: ``service_configs`` rows that hold an AI provider credential
PROVIDER_SERVICE_KEYS: tuple[str, ...] = tuple(PROVIDERS[p].service_key for p in PROVIDER_IDS)

#: ``service_configs`` row holding the AI *selection* (provider, model, fallback)
AI_SETTINGS_KEY = "ai"


def is_known(provider: str) -> bool:
    return provider in PROVIDERS


def meta(provider: str) -> ProviderMeta:
    try:
        return PROVIDERS[provider]
    except KeyError as exc:
        raise KeyError(f"unknown AI provider: {provider!r}") from exc


def provider_for_service_key(service_key: str) -> str | None:
    for pid, pmeta in PROVIDERS.items():
        if pmeta.service_key == service_key:
            return pid
    return None


__all__ = [
    "AI_SETTINGS_KEY",
    "GEMINI",
    "NVIDIA_NIM",
    "OPENROUTER",
    "PROVIDERS",
    "PROVIDER_IDS",
    "PROVIDER_SERVICE_KEYS",
    "ProviderMeta",
    "is_known",
    "meta",
    "provider_for_service_key",
]
