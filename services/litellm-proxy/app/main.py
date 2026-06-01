from __future__ import annotations

import base64
import logging
import os
import time
import urllib.parse
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
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", os.getenv("AI_PROVIDER_API_KEY", ""))
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
OPENROUTER_IMAGE_MODEL = os.getenv("OPENROUTER_IMAGE_MODEL", os.getenv("NANOBANANA_IMAGE_MODEL", "google/gemini-2.5-flash-image-preview"))
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", os.getenv("IMAGE_MODEL", "dall-e-3"))
POLLINATIONS_IMAGE_MODEL = os.getenv("POLLINATIONS_IMAGE_MODEL", "flux")
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


def _extract_data_url_from_openrouter(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not isinstance(choices, list) or not choices:
        return None
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return None
    images = message.get("images")
    if isinstance(images, list):
        for image in images:
            if not isinstance(image, dict):
                continue
            image_url = image.get("image_url") or image.get("url")
            if isinstance(image_url, dict):
                image_url = image_url.get("url")
            if isinstance(image_url, str) and image_url.startswith("data:image/"):
                return image_url
    content = message.get("content")
    if isinstance(content, str):
        match = re.search(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+", content)
        if match:
            return match.group(0)
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            image_url = part.get("image_url") or part.get("url")
            if isinstance(image_url, dict):
                image_url = image_url.get("url")
            if isinstance(image_url, str) and image_url.startswith("data:image/"):
                return image_url
    return None


def _image_payload_from_data_url(data_url: str, provider: str, model: str) -> dict[str, Any]:
    header, b64 = data_url.split(",", 1)
    mime_type = header.removeprefix("data:").split(";", 1)[0] or "image/png"
    return {"created": int(time.time()), "provider": provider, "model": model, "data": [{"b64_json": b64, "mime_type": mime_type}]}


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
    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(status_code=400, detail="Campo 'prompt' é obrigatório")

    if OPENROUTER_API_KEY:
        openrouter_body = {
            "model": OPENROUTER_IMAGE_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "modalities": ["image", "text"],
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "https://ai.viaoceanica.com"),
            "X-Title": os.getenv("OPENROUTER_X_TITLE", "ViaOceanica Social Media"),
        }
        response = requests.post(f"{OPENROUTER_BASE_URL}/chat/completions", json=openrouter_body, headers=headers, timeout=LOCAL_TIMEOUT_SECONDS)
        if response.ok:
            payload = response.json()
            data_url = _extract_data_url_from_openrouter(payload) if isinstance(payload, dict) else None
            if data_url:
                return JSONResponse(_image_payload_from_data_url(data_url, "openrouter-nanobanana", openrouter_body["model"]), status_code=response.status_code)
            logger.warning("OpenRouter image generation returned no embedded image; falling back: %s", str(payload)[:500])
        else:
            logger.warning("OpenRouter Nano Banana image generation failed; falling back: %s %s", response.status_code, response.text[:500])

    if OPENAI_API_KEY:
        upstream_body = {
            "model": body.get("model") or OPENAI_IMAGE_MODEL,
            "prompt": prompt,
            "n": int(body.get("n") or 1),
            "size": body.get("size") or "1024x1024",
        }
        # Prefer embeddable b64 for social posts when the selected OpenAI image model supports it.
        if not str(upstream_body["model"]).startswith("gpt-image-1"):
            upstream_body["response_format"] = body.get("response_format") or "b64_json"
        if body.get("quality"):
            upstream_body["quality"] = body.get("quality")
        if body.get("style") and not str(upstream_body["model"]).startswith("gpt-image-1"):
            upstream_body["style"] = body.get("style")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"}
        response = requests.post("https://api.openai.com/v1/images/generations", json=upstream_body, headers=headers, timeout=LOCAL_TIMEOUT_SECONDS)
        if response.ok:
            payload = response.json()
            if isinstance(payload, dict):
                payload["provider"] = "openai-images"
                payload["model"] = upstream_body["model"]
            return JSONResponse(payload, status_code=response.status_code)
        logger.warning("OpenAI image generation failed; falling back to Pollinations image provider: %s %s", response.status_code, response.text[:500])

    # No-key fallback provider so the social-media workflow can still generate real images
    # when the configured paid image key is missing or invalid. Returns OpenAI-compatible data.
    encoded_prompt = urllib.parse.quote(prompt[:1800])
    pollinations_url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width=1024&height=1024&model={urllib.parse.quote(POLLINATIONS_IMAGE_MODEL)}&nologo=true&private=true&enhance=true"
    )
    try:
        image_response = requests.get(pollinations_url, timeout=LOCAL_TIMEOUT_SECONDS)
        image_response.raise_for_status()
        image_b64 = base64.b64encode(image_response.content).decode("ascii")
        mime_type = image_response.headers.get("content-type", "image/jpeg").split(";", 1)[0] or "image/jpeg"
        return JSONResponse({
            "created": int(time.time()),
            "provider": "pollinations",
            "model": POLLINATIONS_IMAGE_MODEL,
            "data": [{"b64_json": image_b64, "mime_type": mime_type}],
        })
    except Exception as exc:
        logger.exception("Pollinations image fallback failed")
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc
