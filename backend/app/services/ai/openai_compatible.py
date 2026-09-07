"""Providers that speak the OpenAI ``/chat/completions`` wire format.

NVIDIA NIM and OpenRouter both expose that contract, so the request/response
plumbing lives here once and each subclass only supplies its identity, its
default endpoint and how it asks for structured output.

The base URL is always configuration, never a constant: a self-hosted NIM
container answers on ``http://nim-host:8000/v1`` exactly like the hosted
``https://integrate.api.nvidia.com/v1`` does, and an OpenRouter-compatible
gateway can be pointed at instead.
"""
from __future__ import annotations

import time

import httpx

from app.services.ai.base import (
    AIProvider,
    AIResponse,
    JSON_SCHEMA,
    Message,
    ModelInfo,
    ResponseFormat,
)
from app.services.ai.errors import AIError, AIInvalidResponse
from app.services.ai import structured


class OpenAICompatibleProvider(AIProvider):
    """Shared implementation of the OpenAI chat-completions dialect."""

    #: extra headers a concrete provider wants on every call (never secrets)
    extra_headers: dict[str, str] = {}

    # ------------------------------------------------------------- request --

    def _headers(self) -> dict[str, str]:
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            **self.extra_headers,
        }
        if self.api_key:
            # Bearer header, never a query string: URLs land in proxy and access
            # logs, headers do not.
            headers["authorization"] = f"Bearer {self.api_key}"
        return headers

    def _apply_response_format(self, payload: dict, fmt: ResponseFormat) -> None:
        """Ask for JSON in this provider's dialect. Overridden per provider."""
        if fmt.wants_json:
            payload["response_format"] = {"type": "json_object"}

    def _prepare_messages(self, messages: list[Message], fmt: ResponseFormat) -> list[dict]:
        """Wire-format the turns, adding a schema instruction when needed.

        A provider with no native schema enforcement still has to be told the
        shape, otherwise a provider swap silently changes the JSON contract the
        automations parse.
        """
        wire = [{"role": m.role, "content": m.content} for m in messages]
        if fmt.wants_json and self._needs_schema_prompt(fmt):
            instruction = structured.schema_instruction(fmt.schema)
            for turn in wire:
                if turn["role"] == "system":
                    turn["content"] = f"{turn['content']}\n\n{instruction}".strip()
                    break
            else:
                wire.insert(0, {"role": "system", "content": instruction})
        return wire

    def _needs_schema_prompt(self, fmt: ResponseFormat) -> bool:
        """True when the schema must be described in the prompt."""
        return True

    async def generate(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: ResponseFormat | None = None,
    ) -> AIResponse:
        fmt = ResponseFormat.coerce(response_format)
        chosen = (model or self.model or self.default_model).strip()
        payload: dict = {
            "model": chosen,
            "messages": self._prepare_messages(messages, fmt),
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = float(temperature)
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)
        self._apply_response_format(payload, fmt)

        started = time.perf_counter()
        try:
            async with self._client() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise self._wrap_transport_error(exc) from exc

        self._raise_for_status(response)
        latency = round((time.perf_counter() - started) * 1000, 1)
        return self._parse_completion(response, chosen, latency, fmt)

    # ------------------------------------------------------------ response --

    def _parse_completion(
        self, response: httpx.Response, model: str, latency: float, fmt: ResponseFormat
    ) -> AIResponse:
        try:
            body = response.json()
        except ValueError as exc:
            raise AIInvalidResponse(
                "the provider did not return JSON", provider=self.id
            ) from exc

        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            # OpenRouter reports upstream failures inside a 200 body.
            error = body.get("error")
            detail = ""
            if isinstance(error, dict):
                detail = " ".join(str(error.get("message") or "").split())[:120]
            raise AIInvalidResponse(
                f"the provider returned no completion{': ' + detail if detail else ''}",
                provider=self.id,
            )

        choice = choices[0] or {}
        message = choice.get("message") or {}
        text = message.get("content")
        if isinstance(text, list):  # some gateways return content parts
            text = "".join(
                part.get("text", "") for part in text if isinstance(part, dict)
            )
        text = str(text or "")
        if not text.strip():
            raise AIInvalidResponse("the model returned an empty response", provider=self.id)

        data = None
        if fmt.wants_json:
            data = structured.parse_json_text(text, provider=self.id)
            structured.validate_against_schema(data, fmt.schema, provider=self.id)

        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        return AIResponse(
            text=text,
            provider=self.id,
            model=str(body.get("model") or model),
            latency_ms=latency,
            finish_reason=str(choice.get("finish_reason") or ""),
            usage={
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
            data=data,
        )

    # -------------------------------------------------------------- models --

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with self._client() as client:
                response = await client.get(f"{self.base_url}/models", headers=self._headers())
        except httpx.HTTPError as exc:
            raise self._wrap_transport_error(exc) from exc
        self._raise_for_status(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise AIInvalidResponse(
                "the model list was not JSON", provider=self.id
            ) from exc
        rows = body.get("data") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            raise AIInvalidResponse("unexpected model list shape", provider=self.id)
        out: list[ModelInfo] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            model_id = str(row.get("id") or "").strip()
            if not model_id:
                continue
            out.append(ModelInfo(id=model_id, label=str(row.get("name") or model_id)))
        return out


class NvidiaNimProvider(OpenAICompatibleProvider):
    """NVIDIA NIM - the platform's recommended primary provider.

    Structured output comes from ``response_format: {"type": "json_object"}``
    plus the schema described in the prompt (see ``_prepare_messages``).

    NIM also has a guided-decoding extension, ``nvext.guided_json``, which
    enforces the schema server-side - but only on engines that implement it.
    Others reject the whole request with HTTP 400 ``unknown field guided_json``,
    which turns a working model into a hard failure. Verified live: the default
    model rejects it, ``openai/gpt-oss-20b`` accepts it. So it is OFF by default
    and opt-in per instance for a deployment that knows its engine supports it.
    """

    id = "nvidia_nim"
    label = "NVIDIA NIM"
    default_base_url = "https://integrate.api.nvidia.com/v1"
    # Verified against the live endpoint. `GET /models` on NIM is a catalogue,
    # not a list of what a given account may invoke: many entries answer 404 on
    # /chat/completions, so the default has to be one that actually serves.
    default_model = "nvidia/nemotron-3-super-120b-a12b"

    #: set True only on an endpoint whose engine implements nvext guided decoding
    enable_guided_json = False

    def _apply_response_format(self, payload: dict, fmt: ResponseFormat) -> None:
        if not fmt.wants_json:
            return
        payload["response_format"] = {"type": "json_object"}
        if self.enable_guided_json and fmt.kind == JSON_SCHEMA and fmt.schema:
            payload["nvext"] = {"guided_json": fmt.schema}


class OpenRouterProvider(OpenAICompatibleProvider):
    """OpenRouter - the fallback provider, and a single door to many models.

    OpenRouter implements OpenAI's ``json_schema`` response format, so the
    schema is enforced by the gateway on models that support it.
    """

    id = "openrouter"
    label = "OpenRouter"
    default_base_url = "https://openrouter.ai/api/v1"
    default_model = "meta-llama/llama-3.3-70b-instruct"
    #: OpenRouter attributes traffic with these; neither carries user data.
    extra_headers = {
        "HTTP-Referer": "https://github.com/automation-center",
        "X-Title": "Automation Center",
    }

    def _needs_schema_prompt(self, fmt: ResponseFormat) -> bool:
        # Native json_schema enforcement makes the prompt copy redundant.
        return fmt.kind != JSON_SCHEMA or not fmt.schema

    def _apply_response_format(self, payload: dict, fmt: ResponseFormat) -> None:
        if not fmt.wants_json:
            return
        if fmt.kind == JSON_SCHEMA and fmt.schema:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": fmt.name, "strict": True, "schema": fmt.schema},
            }
        else:
            payload["response_format"] = {"type": "json_object"}


__all__ = ["AIError", "NvidiaNimProvider", "OpenAICompatibleProvider", "OpenRouterProvider"]
