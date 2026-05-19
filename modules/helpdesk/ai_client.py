"""
AI Client — OpenClaw Integration
Communicates with the OpenClaw gateway to leverage module-specific AI agents.
"""
import httpx
import os
import logging
from typing import Optional

logger = logging.getLogger("helpdesk.ai")

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "helpdesk")


def _parse_reply(data: dict) -> str:
    nested = data.get("data")
    if isinstance(nested, dict):
        if isinstance(nested.get("reply"), str):
            return nested["reply"]
        choice = (nested.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    return message.get("content", "") if isinstance(message, dict) else ""


async def ask_assistant(
    message: str,
    session_id: str,
    agent_id: Optional[str] = None,
    context: Optional[dict] = None,
    model: str = "qwen2.5:14b-instruct",
) -> dict:
    """
    Send a message to the module's OpenClaw AI agent.

    Args:
        message: The user's message
        session_id: Unique session ID (typically tenant_id-user_id)
        agent_id: OpenClaw agent ID (defaults to module slug)
        context: Additional context to include in the system prompt
        model: Model identifier (default: local Ollama chat model)

    Returns:
        dict with 'reply' (str) and 'usage' (dict)
    """
    agent = agent_id or AI_AGENT_ID
    headers = {
        "Content-Type": "application/json",
        "X-OpenClaw-Agent": agent,
    }
    if context:
        headers.update(
            {
                "X-Viao-Tenant-Id": str(context.get("tenant_id", "")),
                "X-Viao-User-Id": str(context.get("user_id", "")),
                "X-Viao-Module-Key": str(context.get("module", agent)),
            }
        )
        company_role = context.get("company_role")
        if company_role:
            headers["X-Viao-Company-Role"] = str(company_role)

    system_prompt = f"Estás a responder como assistente do módulo {agent}."
    if context:
        system_prompt += f" Contexto: tenant_id={context.get('tenant_id')}, user_id={context.get('user_id')}, module={context.get('module')}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{AI_SERVICE_URL}/api/v1/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message},
                    ],
                    "user": session_id,
                },
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            return {
                "reply": _parse_reply(data),
                "usage": (data.get("data") or {}).get("usage", data.get("usage", {})),
                "model": (data.get("data") or {}).get("model", data.get("model", model)),
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"AI request failed: {e.response.status_code} - {e.response.text}")
        return {"reply": "Desculpe, o assistente AI não está disponível neste momento.", "usage": {}, "error": str(e)}
    except Exception as e:
        logger.error(f"AI request error: {e}")
        return {"reply": "Erro ao comunicar com o assistente AI.", "usage": {}, "error": str(e)}
