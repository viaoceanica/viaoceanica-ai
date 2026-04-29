"""
AI Client — OpenClaw Integration
Communicates with the AI service to leverage the module-specific agent.
"""
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("email.ai")

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "email")


async def ask_assistant(
    message: str,
    session_id: str,
    agent_id: Optional[str] = None,
    context: Optional[dict] = None,
    model: str = "qwen2.5:14b-instruct",
) -> dict:
    agent = agent_id or AI_AGENT_ID

    system_prompt = f"Estás a responder como assistente do módulo {agent}."
    if context:
        system_prompt += (
            f" Contexto: tenant_id={context.get('tenant_id')},"
            f" user_id={context.get('user_id')}, module={context.get('module')}"
        )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{AI_SERVICE_URL}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message},
                    ],
                    "user": session_id,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-OpenClaw-Agent": agent,
                },
            )
            response.raise_for_status()
            data = response.json()
            choice = data.get("choices", [{}])[0]
            return {
                "reply": choice.get("message", {}).get("content", ""),
                "usage": data.get("usage", {}),
                "model": data.get("model", model),
            }
    except httpx.HTTPStatusError as exc:
        logger.error("AI request failed: %s - %s", exc.response.status_code, exc.response.text)
        return {
            "reply": "Desculpe, o assistente de email não está disponível neste momento.",
            "usage": {},
            "error": str(exc),
        }
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.error("AI request error: %s", exc)
        return {
            "reply": "Erro ao comunicar com o assistente de email.",
            "usage": {},
            "error": str(exc),
        }
