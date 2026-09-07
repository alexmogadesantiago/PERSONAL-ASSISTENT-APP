"""Google Gemini, kept as an optional provider.

Gemini is no longer a dependency of the platform: with no key it simply reports
``not configured`` and the other providers keep working. It stays implemented
so existing installations - whose key lives in ``GEMINI_API_KEY`` or in the
``gemini`` row of ``service_configs`` - continue to run untouched.

Wire format differs from the OpenAI dialect in three ways, all handled here:
turns are ``contents`` with ``model`` instead of ``assistant``, the system turn
is a separate ``systemInstruction``, and structured output is requested through
``generationConfig.responseSchema`` in Gemini's upper-case schema dialect.
"""
from __future__ import annotations

import time

import httpx

from app.services.ai.base import AIProvider, AIResponse, Message, ModelInfo, ResponseFormat
from app.services.ai.errors import AIInvalidResponse
from app.services.ai import structured


class GeminiProvider(AIProvider):
    id = "gemini"
    label = "Gemini"
    default_base_url = "https://generativelanguage.googleapis.com"
    default_model = "gemini-2.5-flash"

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json", "accept": "application/json"}
        if self.api_key:
            # Header, not `?key=`: query strings are logged by proxies.
            headers["x-goog-api-key"] = self.api_key
        return headers

    # ------------------------------------------------------------- request --

    @staticmethod
    def _split_turns(messages: list[Message]) -> tuple[str, list[dict]]:
        system_parts: list[str] = []
        contents: list[dict] = []
        for message in messages:
            if message.role == "system":
                system_parts.append(message.content)
                continue
            role = "model" if message.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": message.content}]})
        return "\n\n".join(p for p in system_parts if p), contents

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
        system_text, contents = self._split_turns(messages)
        if not contents:  # Gemini rejects an empty `contents`
            contents = [{"role": "user", "parts": [{"text": system_text or ""}]}]
            system_text = ""

        generation_config: dict = {}
        if temperature is not None:
            generation_config["temperature"] = float(temperature)
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = int(max_tokens)
        if fmt.wants_json:
            generation_config["responseMimeType"] = "application/json"
            if fmt.schema:
                generation_config["responseSchema"] = structured.to_gemini_schema(fmt.schema)

        payload: dict = {"contents": contents}
        if system_text:
            payload["systemInstruction"] = {"parts": [{"text": system_text}]}
        if generation_config:
            payload["generationConfig"] = generation_config

        url = f"{self.base_url}/v1beta/models/{chosen}:generateContent"
        started = time.perf_counter()
        try:
            async with self._client() as client:
                response = await client.post(url, headers=self._headers(), json=payload)
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
            raise AIInvalidResponse("the provider did not return JSON", provider=self.id) from exc

        candidates = body.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            blocked = (body.get("promptFeedback") or {}).get("blockReason")
            raise AIInvalidResponse(
                f"the model returned no candidate{f' (blocked: {blocked})' if blocked else ''}",
                provider=self.id,
            )
        candidate = candidates[0] or {}
        parts = ((candidate.get("content") or {}).get("parts")) or []
        text = "".join(
            str(part.get("text") or "") for part in parts if isinstance(part, dict)
        )
        if not text.strip():
            raise AIInvalidResponse("the model returned an empty response", provider=self.id)

        data = None
        if fmt.wants_json:
            data = structured.parse_json_text(text, provider=self.id)
            structured.validate_against_schema(data, fmt.schema, provider=self.id)

        usage = body.get("usageMetadata") if isinstance(body.get("usageMetadata"), dict) else {}
        return AIResponse(
            text=text,
            provider=self.id,
            model=model,
            latency_ms=latency,
            finish_reason=str(candidate.get("finishReason") or ""),
            usage={
                "prompt_tokens": usage.get("promptTokenCount"),
                "completion_tokens": usage.get("candidatesTokenCount"),
                "total_tokens": usage.get("totalTokenCount"),
            },
            data=data,
        )

    # -------------------------------------------------------------- models --

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{self.base_url}/v1beta/models", headers=self._headers()
                )
        except httpx.HTTPError as exc:
            raise self._wrap_transport_error(exc) from exc
        self._raise_for_status(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise AIInvalidResponse("the model list was not JSON", provider=self.id) from exc
        rows = body.get("models") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            raise AIInvalidResponse("unexpected model list shape", provider=self.id)

        out: list[ModelInfo] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            model_id = name.split("/", 1)[1] if name.startswith("models/") else name
            if not model_id:
                continue
            methods = row.get("supportedGenerationMethods")
            # Embedding-only models cannot serve a completion; hiding them keeps
            # the panel's selector honest.
            if isinstance(methods, list) and "generateContent" not in methods:
                continue
            out.append(ModelInfo(id=model_id, label=str(row.get("displayName") or model_id)))
        return out


__all__ = ["GeminiProvider"]
