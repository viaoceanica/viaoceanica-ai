#!/bin/bash
# ─── OpenClaw Agent Setup for Helpdesk ──────────────────────────
#
# This script creates and configures the OpenClaw agent for this module.
# Run this ONCE on the VPS after deploying the module.
#
# Prerequisites:
#   - OpenClaw installed and running on the VPS
#   - openclaw CLI available in PATH
#
# Usage:
#   chmod +x setup-agent.sh
#   ./setup-agent.sh
#

set -euo pipefail

AGENT_ID="helpdesk"
AGENT_NAME="Assistente Helpdesk"
AGENT_EMOJI="🤖"
WORKSPACE_DIR="/root/openclaw/workspace/agents/${AGENT_ID}"
SOUL_FILE="$(dirname "$0")/SOUL.md"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OpenClaw Agent Setup — ${AGENT_NAME}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 1. Create workspace directory
echo "→ Creating workspace at ${WORKSPACE_DIR}..."
mkdir -p "${WORKSPACE_DIR}"

# 2. Copy SOUL.md to workspace
if [ -f "${SOUL_FILE}" ]; then
  cp "${SOUL_FILE}" "${WORKSPACE_DIR}/SOUL.md"
  echo "  ✓ SOUL.md copied"
else
  echo "  ⚠ SOUL.md not found at ${SOUL_FILE}, using default"
fi

# 3. Register agent with OpenClaw
echo "→ Registering agent '${AGENT_ID}'..."
openclaw agents add "${AGENT_ID}" \
  --workspace "${WORKSPACE_DIR}" \
  --model openai/gpt-5.4 \
  --non-interactive

# 4. Set agent identity
echo "→ Setting identity..."
openclaw agents set-identity \
  --agent "${AGENT_ID}" \
  --name "${AGENT_NAME}" \
  --emoji "${AGENT_EMOJI}"

# 5. Restart gateway to pick up new agent
echo "→ Restarting OpenClaw gateway..."
openclaw gateway restart

echo ""
echo "✅ Agent '${AGENT_ID}' registered and ready!"
echo ""
echo "Test with:"
echo "  openclaw agent --agent ${AGENT_ID} --message \"Olá, teste de integração\""
echo ""
echo "The agent will be available at:"
echo "  POST http://localhost:18789/v1/chat/completions"
echo "  Header: X-OpenClaw-Agent: ${AGENT_ID}"
