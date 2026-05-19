from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from litellm import completion, embedding

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

APP_START = time.time()
APP_PORT = int(os.getenv("PORT", "4025"))
LOCAL_AI_BASE_URL = os.getenv("LOCAL_AI_BASE_URL", os.getenv("UPSTREAM_AI_BASE_URL", "http://host.docker.internal:11434")).rstrip("/")
LOCAL_AI_API_KEY = os.getenv("LOCAL_AI_API_KEY", os.getenv("UPSTREAM_AI_API_KEY", "ollama"))
LOCAL_AI_PROVIDER = os.getenv("LOCAL_AI_PROVIDER", "ollama")
DEFAULT_CHAT_MODEL = os.getenv("DEFAULT_CHAT_MODEL", "qwen2.5:14b-instruct")
DEFAULT_EMBEDDING_MODEL = os.getenv("DEFAULT_EMBEDDING_MODEL", "qwen3-embedding:8b")
LOCAL_TIMEOUT_SECONDS = float(os.getenv("LOCAL_TIMEOUT_SECONDS", os.getenv("UPSTREAM_TIMEOUT_SECONDS", "120")))

app = FastAPI(title="Via Oceânica LiteLLM Proxy", version="1.0.0")


def _as_plain_dict(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        try:
            return value.dict()
        except Exception:
            pass
    return value


def _candidate_endpoints() -> list[dict[str, str]]:
    return [
        {
            "label": "local",
            "api_base": LOCAL_AI_BASE_URL,
            "api_key": LOCAL_AI_API_KEY,
            "timeout": str(LOCAL_TIMEOUT_SECONDS),
        }
    ]


def _try_completion(**kwargs: Any):
    last_error: Exception | None = None
    for candidate in _candidate_endpoints():
        try:
            provider = LOCAL_AI_PROVIDER
            model = kwargs.get("model")
            if isinstance(model, str) and "/" not in model:
                model = f"{provider}/{model}"
            return completion(
                base_url=candidate["api_base"],
                api_key=candidate["api_key"] or None,
                timeout=float(candidate["timeout"]),
                model=model,
                custom_llm_provider=provider,
                **{k: v for k, v in kwargs.items() if k != "model"},
            ), candidate["label"]
        except Exception as exc:
            logger.warning("LiteLLM completion failed on %s endpoint: %s", candidate["label"], exc)
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("No AI endpoint configured")


def _try_embedding(**kwargs: Any):
    last_error: Exception | None = None
    for candidate in _candidate_endpoints():
        try:
            provider = LOCAL_AI_PROVIDER
            model = kwargs.get("model")
            return embedding(
                api_base=candidate["api_base"],
                api_key=candidate["api_key"] or None,
                timeout=float(candidate["timeout"]),
                custom_llm_provider=provider,
                **{**kwargs, "model": model},
            ), candidate["label"]
        except Exception as exc:
            logger.warning("LiteLLM embedding failed on %s endpoint: %s", candidate["label"], exc)
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("No AI endpoint configured")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "litellm-proxy",
        "uptime_seconds": int(time.time() - APP_START),
    }


@app.get("/ready")
def ready() -> dict[str, Any]:
    return {
        "status": "ready",
        "dependencies": {
            "local_ai_base_url": "configured" if LOCAL_AI_BASE_URL else "missing",
        },
    }


@app.post("/v1/chat/completions")
def chat_completions(payload: dict[str, Any]) -> JSONResponse:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="Campo 'messages' é obrigatório")

    model = payload.get("model") or DEFAULT_CHAT_MODEL
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": payload.get("temperature", 0.7),
        "max_tokens": payload.get("max_tokens"),
        "response_format": payload.get("response_format"),
    }
    if payload.get("stream"):
        kwargs["stream"] = False

    try:
        response, provider = _try_completion(**kwargs)
        data = _as_plain_dict(response)
        if isinstance(data, dict):
            data["provider"] = provider
        return JSONResponse(data)
    except Exception as exc:
        logger.exception("LiteLLM chat completion failed")
        raise HTTPException(status_code=500, detail=f"LiteLLM chat error: {exc}") from exc


@app.post("/v1/embeddings")
def embeddings(payload: dict[str, Any]) -> JSONResponse:
    input_text = payload.get("input")
    if input_text is None:
        raise HTTPException(status_code=400, detail="Campo 'input' é obrigatório")

    model = payload.get("model") or DEFAULT_EMBEDDING_MODEL
    try:
        response, provider = _try_embedding(
            model=model,
            input=input_text,
        )
        data = _as_plain_dict(response)
        if isinstance(data, dict):
            data["provider"] = provider
        return JSONResponse(data)
    except Exception as exc:
        logger.exception("LiteLLM embeddings failed")
        raise HTTPException(status_code=500, detail=f"LiteLLM embeddings error: {exc}") from exc


@app.post("/v1/images/generations")
async def images_generations(request: Request) -> JSONResponse:
    body = await request.json()
    last_response = None
    for candidate in _candidate_endpoints():
        upstream_url = f"{candidate['api_base']}/images/generations"
        headers = {"Content-Type": "application/json"}
        if candidate["api_key"]:
            headers["Authorization"] = f"Bearer {candidate['api_key']}"

        response = requests.post(upstream_url, json=body, headers=headers, timeout=LOCAL_TIMEOUT_SECONDS)
        last_response = response
        if response.ok:
            payload = response.json()
            if isinstance(payload, dict):
                payload["provider"] = candidate["label"]
            return JSONResponse(payload, status_code=response.status_code)

    if last_response is not None:
        return JSONResponse(last_response.json(), status_code=last_response.status_code)
    raise HTTPException(status_code=500, detail="LiteLLM image generation failed")
