#!/bin/bash
set -euo pipefail

AGENT_ID="email"
AGENT_NAME="Assistente Email"
WORKSPACE_DIR="/root/openclaw/workspace/agents/${AGENT_ID}"
SOUL_FILE="$(dirname "$0")/SOUL.md"

echo "→ Creating workspace at ${WORKSPACE_DIR}..."
mkdir -p "${WORKSPACE_DIR}"

if [ -f "${SOUL_FILE}" ]; then
  cp "${SOUL_FILE}" "${WORKSPACE_DIR}/SOUL.md"
fi

echo "→ Registering agent ${AGENT_ID}..."
openclaw agents add "${AGENT_ID}" \
  --workspace "${WORKSPACE_DIR}" \
  --model openai/gpt-5.4 \
  --non-interactive

echo "→ Restarting OpenClaw gateway..."
openclaw gateway restart

echo "✅ Agent '${AGENT_ID}' registered."
