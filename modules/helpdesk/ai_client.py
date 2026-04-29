"""
AI Client — OpenClaw Integration
Communicates with the OpenClaw gateway to leverage module-specific AI agents.
"""
import httpx
import os
import logging
from typing import Optional

logger = logging.getLogger("helpdesk.ai")

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://host.docker.internal:4000/v1")
AI_SERVICE_API_KEY = os.getenv("AI_SERVICE_API_KEY", "")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "helpdesk")
AI_MODEL = os.getenv("AI_MODEL", "helpdesk-chat")


async def ask_assistant(
    message: str,
    session_id: str,
    agent_id: Optional[str] = None,
    context: Optional[dict] = None,
    model: Optional[str] = None,
) -> dict:
    """
    Send a message to the module's OpenClaw AI agent.

    Args:
        message: The user's message
        session_id: Unique session ID (typically tenant_id-user_id)
        agent_id: OpenClaw agent ID (defaults to module slug)
        context: Additional context to include in the system prompt
        model: Model identifier (default: "openclaw" which routes through OpenClaw)

    Returns:
        dict with 'reply' (str) and 'usage' (dict)
    """
    agent = agent_id or AI_AGENT_ID
    selected_model = model or AI_MODEL

    system_prompt = f"Estás a responder como assistente do módulo {agent}."
    if context:
        system_prompt += f" Contexto: tenant_id={context.get('tenant_id')}, user_id={context.get('user_id')}, module={context.get('module')}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{AI_SERVICE_URL}/chat/completions",
                json={
                    "model": selected_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message},
                    ],
                    "user": session_id,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-OpenClaw-Agent": agent,
                    **({"Authorization": f"Bearer {AI_SERVICE_API_KEY}"} if AI_SERVICE_API_KEY else {}),
                },
            )
            response.raise_for_status()
            data = response.json()

            choice = data.get("choices", [{}])[0]
            return {
                "reply": choice.get("message", {}).get("content", ""),
                "usage": data.get("usage", {}),
                "model": data.get("model", selected_model),
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"AI request failed: {e.response.status_code} - {e.response.text}")
        return {"reply": "Desculpe, o assistente AI não está disponível neste momento.", "usage": {}, "error": str(e)}
    except Exception as e:
        logger.error(f"AI request error: {e}")
        return {"reply": "Erro ao comunicar com o assistente AI.", "usage": {}, "error": str(e)}
