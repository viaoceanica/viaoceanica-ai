from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Sequence

from openai import OpenAI

from .config import get_settings

settings = get_settings()
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "120"))


@dataclass
class LLMResult:
    text: str
    usage: dict[str, int]
    model: str | None = None
    raw: Any = None


def _client() -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada")
    return OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_api_base,
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )


def _usage_from_response(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None) or {}
    input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)
    if isinstance(usage, dict):
        input_tokens = usage.get("input_tokens", input_tokens)
        output_tokens = usage.get("output_tokens", output_tokens)
        total_tokens = usage.get("total_tokens", total_tokens)
        prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
        completion_tokens = usage.get("completion_tokens", completion_tokens)
    input_tokens = int(input_tokens or prompt_tokens or 0)
    output_tokens = int(output_tokens or completion_tokens or 0)
    total_tokens = int(total_tokens or (input_tokens + output_tokens))
    return {"input": input_tokens, "output": output_tokens, "total": total_tokens}


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
                continue
            text = getattr(item, "text", None)
            if text:
                parts.append(str(text))
        return "\n".join(part for part in parts if part).strip()
    return str(content or "")


def complete_text(
    *,
    model: str,
    messages: Sequence[dict[str, Any]],
    max_output_tokens: int,
    temperature: float = 0.0,
) -> LLMResult:
    response = _client().chat.completions.create(
        model=model,
        messages=list(messages),
        temperature=temperature,
        max_completion_tokens=max_output_tokens,
    )
    content = response.choices[0].message.content if response.choices else ""
    return LLMResult(
        text=_message_text(content).strip(),
        usage=_usage_from_response(response),
        model=getattr(response, "model", None) or model,
        raw=response,
    )


def complete_prompt(
    *,
    model: str,
    prompt: str,
    max_output_tokens: int,
    temperature: float = 0.0,
) -> LLMResult:
    return complete_text(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_output_tokens=max_output_tokens,
        temperature=temperature,
    )


def vision_text(
    *,
    model: str,
    prompt: str,
    image_data_urls: Sequence[str],
    max_output_tokens: int,
) -> LLMResult:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": data_url}})
    return complete_text(
        model=model,
        messages=[{"role": "user", "content": content}],
        max_output_tokens=max_output_tokens,
        temperature=0.0,
    )


def create_embedding(*, model: str, input_value: str | list[str]) -> Any:
    return _client().embeddings.create(model=model, input=input_value, encoding_format="float")
