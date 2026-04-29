from __future__ import annotations

import logging
import os
from typing import Any

import requests

from .config import get_settings
from .middleware import get_module_context

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_TIMEOUT_SECONDS = float(os.getenv("AI_SERVICE_TIMEOUT_SECONDS", "120"))


class AIServiceError(RuntimeError):
    pass


def _service_base_url() -> str:
    return (settings.ai_service_url or os.getenv("AI_SERVICE_URL", "http://ai-service:4010")).rstrip("/")


def _context_headers(context_headers: dict[str, str] | None = None) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if context_headers:
        headers.update({k: v for k, v in context_headers.items() if v})
        return headers
    try:
        ctx = get_module_context()
        headers.update(
            {
                "X-Viao-User-Id": ctx.user_id,
                "X-Viao-Tenant-Id": ctx.tenant_id,
                "X-Viao-Module-Key": "contabilidade",
                "X-Viao-Request-Id": ctx.request_id,
            }
        )
    except Exception:
        pass
    return headers


def _post(
    path: str,
    payload: dict[str, Any],
    timeout: float | None = None,
    context_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = f"{_service_base_url()}{path}"
    headers = _context_headers(context_headers)
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout or DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise AIServiceError(f"Falha ao chamar AI service em {path}: {exc}") from exc


def _usage_from_payload(payload: dict[str, Any] | None) -> dict[str, int]:
    payload = payload or {}
    return {
        "input": int(payload.get("prompt_tokens") or payload.get("input_tokens") or 0),
        "output": int(payload.get("completion_tokens") or payload.get("output_tokens") or 0),
        "total": int(payload.get("total_tokens") or 0),
    }


def _unwrap_ai_service_payload(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, dict):
        return data
    return payload


def chat_completion(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
    response_format: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
    context_headers: dict[str, str] | None = None,
) -> tuple[str, dict[str, int]]:
    data = _unwrap_ai_service_payload(_post(
        "/api/v1/chat/completions",
        {
            "model": model or settings.extraction_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "response_format": response_format,
        },
        timeout=timeout_seconds,
        context_headers=context_headers,
    ))
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content") or ""
    return content, _usage_from_payload(data.get("usage"))


def embeddings_create(
    *,
    input_text: str | list[str],
    model: str | None = None,
    timeout_seconds: float | None = None,
    context_headers: dict[str, str] | None = None,
) -> list[float]:
    data = _unwrap_ai_service_payload(_post(
        "/api/v1/embeddings",
        {
            "model": model or settings.embedding_model,
            "input": input_text,
        },
        timeout=timeout_seconds,
        context_headers=context_headers,
    ))
    embedding_data = (data.get("data") or [{}])[0]
    embedding = embedding_data.get("embedding") or []
    return list(embedding)
