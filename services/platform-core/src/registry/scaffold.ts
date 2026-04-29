/**
 * Module Scaffold ZIP Generator
 *
 * Generates a complete scaffold ZIP for a new module based on the
 * module configuration (slug, name, mountType, backendLanguage, etc.)
 *
 * Includes:
 * - Full docker-compose.yml (not just a snippet) for immediate spin-up
 * - OpenClaw agent setup script + SOUL.md template
 * - AI service integration boilerplate
 * - .env.example with all required variables
 */
import archiver from "archiver";
import { PassThrough } from "stream";

export type ScaffoldConfig = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  mountType: string; // "iframe" | "internal" | "api_only"
  backendLanguage: string; // "python" | "nodejs"
  databaseMode: string; // "shared" | "separate"
  capabilities: string[];
  port: number;
};

function slugToUnderscore(slug: string): string {
  return slug.replace(/-/g, "_");
}

function slugToUpperEnv(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

// ─── Python Backend Templates ─────────────────────────────────────

function pythonMain(cfg: ScaffoldConfig): string {
  return `"""
${cfg.name} — Backend Service
Via Oceânica AI Platform Module
"""
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("${cfg.slug}")

PORT = int(os.getenv("MOD_${slugToUpperEnv(cfg.slug)}_PORT", "${cfg.port}"))
DATABASE_URL = os.getenv("DATABASE_URL", "")

# ─── AI Service Configuration ──────────────────────────────────────
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "${cfg.slug}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[${cfg.slug}] Starting on port {PORT}")
    # Startup: connect DB, init resources
    yield
    # Shutdown: cleanup
    logger.info(f"[${cfg.slug}] Shutting down")

app = FastAPI(
    title="${cfg.name}",
    description="${cfg.description || ""}",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Platform Headers Middleware ────────────────────────────────────
@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    """Extract x-viao-* headers injected by the gateway."""
    request.state.tenant_id = request.headers.get("x-viao-tenant-id")
    request.state.user_id = request.headers.get("x-viao-user-id")
    request.state.user_role = request.headers.get("x-viao-user-role")
    request.state.module_key = request.headers.get("x-viao-module-key")
    response = await call_next(request)
    return response

# ─── Health Endpoints ───────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "${cfg.slug}", "version": "1.0.0"}

@app.get("/ready")
async def ready():
    # TODO: Check database connectivity
    return {"status": "ready", "dependencies": {"database": "ok"}}

# ─── AI Integration ────────────────────────────────────────────────
from ai_client import ask_assistant

@app.post("/api/v1/ai/chat")
async def ai_chat(request: Request):
    """Chat with the module-specific AI assistant via OpenClaw."""
    body = await request.json()
    message = body.get("message", "")
    session_id = body.get("session_id", f"{request.state.tenant_id}-{request.state.user_id}")

    response = await ask_assistant(
        message=message,
        session_id=session_id,
        agent_id=AI_AGENT_ID,
        context={
            "tenant_id": request.state.tenant_id,
            "user_id": request.state.user_id,
            "module": "${cfg.slug}",
        }
    )
    return {"success": True, "data": response}

# ─── API Routes ─────────────────────────────────────────────────────
@app.get("/api/v1/status")
async def status(request: Request):
    return {
        "success": True,
        "data": {
            "module": "${cfg.slug}",
            "tenant_id": request.state.tenant_id,
            "message": "${cfg.name} está operacional"
        }
    }

# TODO: Add your module-specific routes here
# Example:
# @app.get("/api/v1/items")
# async def list_items(request: Request):
#     tenant_id = request.state.tenant_id
#     return {"success": True, "data": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
`;
}

function pythonAiClient(cfg: ScaffoldConfig): string {
  return `"""
AI Client — OpenClaw Integration
Communicates with the OpenClaw gateway to leverage module-specific AI agents.
"""
import httpx
import os
import logging
from typing import Optional

logger = logging.getLogger("${cfg.slug}.ai")

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "${cfg.slug}")


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

    system_prompt = f"Estás a responder como assistente do módulo {agent}."
    if context:
        system_prompt += f" Contexto: tenant_id={context.get('tenant_id')}, user_id={context.get('user_id')}, module={context.get('module')}"

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

    except httpx.HTTPStatusError as e:
        logger.error(f"AI request failed: {e.response.status_code} - {e.response.text}")
        return {"reply": "Desculpe, o assistente AI não está disponível neste momento.", "usage": {}, "error": str(e)}
    except Exception as e:
        logger.error(f"AI request error: {e}")
        return {"reply": "Erro ao comunicar com o assistente AI.", "usage": {}, "error": str(e)}
`;
}

function pythonRequirements(cfg: ScaffoldConfig): string {
  const deps = [
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    "python-dotenv>=1.0.0",
    "httpx>=0.25.0",
  ];
  if (cfg.capabilities.includes("ai")) deps.push("openai>=1.3.0");
  if (cfg.capabilities.includes("storage")) deps.push("boto3>=1.29.0");
  if (cfg.capabilities.includes("email")) deps.push("aiosmtplib>=2.0.0");
  // Database
  deps.push("asyncpg>=0.29.0", "sqlalchemy[asyncio]>=2.0.0");
  return deps.join("\n") + "\n";
}

function pythonDockerfile(cfg: ScaffoldConfig): string {
  return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE ${cfg.port}

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${cfg.port}"]
`;
}

// ─── Node.js Backend Templates ────────────────────────────────────

function nodejsMain(cfg: ScaffoldConfig): string {
  return `/**
 * ${cfg.name} — Backend Service
 * Via Oceânica AI Platform Module
 */
import express from "express";
import cors from "cors";
import { askAssistant } from "./ai-client.js";

const PORT = parseInt(process.env.MOD_${slugToUpperEnv(cfg.slug)}_PORT || "${cfg.port}");
const DATABASE_URL = process.env.DATABASE_URL || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Platform Headers Middleware ────────────────────────────────────
app.use((req, _res, next) => {
  (req as any).tenantId = req.headers["x-viao-tenant-id"];
  (req as any).userId = req.headers["x-viao-user-id"];
  (req as any).userRole = req.headers["x-viao-user-role"];
  (req as any).moduleKey = req.headers["x-viao-module-key"];
  next();
});

// ─── Health Endpoints ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "${cfg.slug}", version: "1.0.0" });
});

app.get("/ready", (_req, res) => {
  // TODO: Check database connectivity
  res.json({ status: "ready", dependencies: { database: "ok" } });
});

// ─── AI Chat Endpoint ──────────────────────────────────────────────
app.post("/api/v1/ai/chat", async (req, res) => {
  try {
    const { message, session_id } = req.body;
    const sessionId = session_id || \`\${(req as any).tenantId}-\${(req as any).userId}\`;

    const response = await askAssistant({
      message,
      sessionId,
      context: {
        tenantId: (req as any).tenantId,
        userId: (req as any).userId,
        module: "${cfg.slug}",
      },
    });

    res.json({ success: true, data: response });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── API Routes ─────────────────────────────────────────────────────
app.get("/api/v1/status", (req, res) => {
  res.json({
    success: true,
    data: {
      module: "${cfg.slug}",
      tenant_id: (req as any).tenantId,
      message: "${cfg.name} está operacional"
    }
  });
});

// TODO: Add your module-specific routes here

app.listen(PORT, () => {
  console.log(\`[${cfg.slug}] Running on http://localhost:\${PORT}\`);
});
`;
}

function nodejsAiClient(cfg: ScaffoldConfig): string {
  return `/**
 * AI Client — OpenClaw Integration
 * Communicates with the OpenClaw gateway to leverage module-specific AI agents.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
const AI_AGENT_ID = process.env.AI_AGENT_ID || "${cfg.slug}";

interface AskAssistantParams {
  message: string;
  sessionId: string;
  agentId?: string;
  context?: {
    tenantId?: string;
    userId?: string;
    module?: string;
  };
  model?: string;
}

interface AskAssistantResponse {
  reply: string;
  usage: Record<string, number>;
  model?: string;
  error?: string;
}

/**
 * Send a message to the module's OpenClaw AI agent.
 *
 * @param params.message - The user's message
 * @param params.sessionId - Unique session ID (typically tenantId-userId)
 * @param params.agentId - OpenClaw agent ID (defaults to module slug)
 * @param params.context - Additional context for the system prompt
 * @param params.model - Model identifier (default: local Ollama chat model)
 */
export async function askAssistant(params: AskAssistantParams): Promise<AskAssistantResponse> {
  const { message, sessionId, agentId, context, model = "qwen2.5:14b-instruct" } = params;
  const agent = agentId || AI_AGENT_ID;

  let systemPrompt = \`Estás a responder como assistente do módulo \${agent}.\`;
  if (context) {
    systemPrompt += \` Contexto: tenant_id=\${context.tenantId}, user_id=\${context.userId}, module=\${context.module}\`;
  }

  try {
    const response = await fetch(\`\${AI_SERVICE_URL}/chat/completions\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenClaw-Agent": agent,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        user: sessionId,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(\`[ai-client] HTTP \${response.status}: \${errorText}\`);
      return {
        reply: "Desculpe, o assistente AI não está disponível neste momento.",
        usage: {},
        error: \`HTTP \${response.status}\`,
      };
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      reply: choice?.message?.content || "",
      usage: data.usage || {},
      model: data.model || model,
    };
  } catch (error: any) {
    console.error(\`[ai-client] Error: \${error.message}\`);
    return {
      reply: "Erro ao comunicar com o assistente AI.",
      usage: {},
      error: error.message,
    };
  }
}
`;
}

function nodejsPackageJson(cfg: ScaffoldConfig): string {
  const deps: Record<string, string> = {
    express: "^4.18.2",
    cors: "^2.8.5",
    tsx: "^4.7.0",
  };
  if (cfg.capabilities.includes("ai")) deps["openai"] = "^4.20.0";
  if (cfg.capabilities.includes("storage")) deps["@aws-sdk/client-s3"] = "^3.450.0";

  return JSON.stringify({
    name: `mod-${cfg.slug}`,
    version: "1.0.0",
    description: cfg.description || cfg.name,
    type: "module",
    scripts: {
      dev: `tsx watch src/index.ts`,
      start: `tsx src/index.ts`,
    },
    dependencies: deps,
  }, null, 2) + "\n";
}

function nodejsDockerfile(cfg: ScaffoldConfig): string {
  return `FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install

COPY . .

EXPOSE ${cfg.port}

CMD ["npm", "start"]
`;
}

// ─── Frontend Templates (for iframe mount) ────────────────────────

function frontendNextConfig(cfg: ScaffoldConfig): string {
  return `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/module/${cfg.slug}",
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: \`\${process.env.SERVER_API_BASE_URL || "http://mod-${cfg.slug}:${cfg.port}"}/api/:path*\`,
      },
    ];
  },
};

module.exports = nextConfig;
`;
}

function frontendPackageJson(cfg: ScaffoldConfig): string {
  return JSON.stringify({
    name: `${cfg.slug}-frontend`,
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start -p 3000",
    },
    dependencies: {
      next: "^14.0.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
    },
    devDependencies: {
      typescript: "^5.3.0",
      "@types/react": "^18.2.0",
      "@types/node": "^20.10.0",
    },
  }, null, 2) + "\n";
}

function frontendPage(cfg: ScaffoldConfig): string {
  return `"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/module/${cfg.slug}/api/v1/status")
      .then(r => r.json())
      .then(setStatus)
      .catch(console.error);
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>${cfg.name}</h1>
      <p>${cfg.description || "Módulo da plataforma Via Oceânica"}</p>
      {status && (
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "8px" }}>
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </main>
  );
}
`;
}

function frontendLayout(cfg: ScaffoldConfig): string {
  return `export const metadata = {
  title: "${cfg.name}",
  description: "${cfg.description || ""}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
`;
}

function frontendDockerfile(cfg: ScaffoldConfig): string {
  return `FROM node:20-slim AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
`;
}

// ─── Manifest ─────────────────────────────────────────────────────

function moduleManifest(cfg: ScaffoldConfig): string {
  return JSON.stringify({
    module_key: cfg.slug,
    name: cfg.name,
    version: "1.0.0",
    description: cfg.description || "",
    route: `/module/${cfg.slug}`,
    frontend_mount_type: cfg.mountType,
    backend_service_url: `http://mod-${cfg.slug}:${cfg.port}`,
    health_endpoint: "/health",
    readiness_endpoint: "/ready",
    status: "active",
    icon: cfg.icon || "Package",
    capabilities: cfg.capabilities,
    ai_agent_id: cfg.slug,
    min_plan: null,
    tenant_restricted: false,
  }, null, 2) + "\n";
}

// ─── OpenClaw Agent Setup ─────────────────────────────────────────

function agentSoulMd(cfg: ScaffoldConfig): string {
  return `# SOUL.md — Assistente ${cfg.name}

## Quem és
És o assistente especializado do módulo "${cfg.name}" da plataforma Via Oceânica.
${cfg.description ? `A tua área de especialização: ${cfg.description}` : ""}

## Idioma
Responde sempre em português europeu (pt-PT).

## Competências
- Ajudar utilizadores com questões relacionadas com ${cfg.name}
- Analisar dados e fornecer recomendações práticas
- Explicar conceitos do domínio de forma clara e acessível
- Sugerir melhorias baseadas nas melhores práticas do sector

## Comportamento
- Sê direto e orientado para resultados
- Usa linguagem profissional mas acessível
- Quando relevante, apresenta dados em tabelas
- Se a informação for insuficiente, pede esclarecimentos
- Nunca inventes dados — se não sabes, diz que não sabes

## Contexto da Plataforma
Estás integrado no módulo "${cfg.name}" da Via Oceânica, uma plataforma SaaS multi-tenant para PMEs portuguesas.
Os utilizadores acedem a ti através do chat integrado no módulo.

## Limites
- Não acedes a dados de outros tenants ou módulos
- Não executas operações na base de dados — apenas aconselhas
- Recomenda sempre consultar um profissional para decisões críticas
`;
}

function agentSetupScript(cfg: ScaffoldConfig): string {
  return `#!/bin/bash
# ─── OpenClaw Agent Setup for ${cfg.name} ──────────────────────────
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

AGENT_ID="${cfg.slug}"
AGENT_NAME="Assistente ${cfg.name}"
AGENT_EMOJI="${cfg.icon === "Utensils" ? "🍽️" : cfg.icon === "Calculator" ? "📊" : cfg.icon === "Mail" ? "📧" : "🤖"}"
WORKSPACE_DIR="/root/openclaw/workspace/agents/\${AGENT_ID}"
SOUL_FILE="\$(dirname "\$0")/SOUL.md"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OpenClaw Agent Setup — \${AGENT_NAME}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 1. Create workspace directory
echo "→ Creating workspace at \${WORKSPACE_DIR}..."
mkdir -p "\${WORKSPACE_DIR}"

# 2. Copy SOUL.md to workspace
if [ -f "\${SOUL_FILE}" ]; then
  cp "\${SOUL_FILE}" "\${WORKSPACE_DIR}/SOUL.md"
  echo "  ✓ SOUL.md copied"
else
  echo "  ⚠ SOUL.md not found at \${SOUL_FILE}, using default"
fi

# 3. Register agent with OpenClaw
echo "→ Registering agent '\${AGENT_ID}'..."
openclaw agents add "\${AGENT_ID}" \\
  --workspace "\${WORKSPACE_DIR}" \\
  --model openai/gpt-5.4 \\
  --non-interactive

# 4. Set agent identity
echo "→ Setting identity..."
openclaw agents set-identity \\
  --agent "\${AGENT_ID}" \\
  --name "\${AGENT_NAME}" \\
  --emoji "\${AGENT_EMOJI}"

# 5. Restart gateway to pick up new agent
echo "→ Restarting OpenClaw gateway..."
openclaw gateway restart

echo ""
echo "✅ Agent '\${AGENT_ID}' registered and ready!"
echo ""
echo "Test with:"
echo "  openclaw agent --agent \${AGENT_ID} --message \\"Olá, teste de integração\\""
echo ""
echo "The agent will be available at:"
echo "  POST http://localhost:4010/v1/chat/completions"
echo "  Header: X-OpenClaw-Agent: \${AGENT_ID}"
`;
}

// ─── Full Docker Compose ──────────────────────────────────────────

function fullDockerCompose(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  const slugUnder = slugToUnderscore(cfg.slug);
  const dbName = cfg.databaseMode === "separate"
    ? `viaoceanica_${slugUnder}`
    : "viaoceanica_platform";

  let yaml = `# ─── ${cfg.name} — Docker Compose ──────────────────────────────────
# Full docker-compose.yml for standalone development and deployment.
#
# Quick start:
#   cp .env.example .env
#   docker compose up -d
#
# This file includes:
#   - Backend service (mod-${cfg.slug})
${cfg.mountType === "iframe" ? `#   - Frontend service (${cfg.slug}-frontend)\n` : ""}#   - PostgreSQL database
#   - Redis cache
#   - Volumes for data persistence
#
# For production deployment, merge these services into the main
# docker-compose.yml of the Via Oceânica platform.
# ──────────────────────────────────────────────────────────────────

x-common-env: &common-env
  NODE_ENV: \${NODE_ENV:-development}
  REDIS_URL: redis://redis:6379
  TZ: Europe/Lisbon

services:
  # ─── Module Backend ──────────────────────────────────────────────
  mod-${cfg.slug}:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "\${MOD_${keyUpper}_PORT:-${cfg.port}}:${cfg.port}"
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${cfg.port}"
      DATABASE_URL: postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/${dbName}
      AI_SERVICE_URL: \${AI_SERVICE_URL:-http://ai-service:4010}
      AI_AGENT_ID: \${AI_AGENT_ID:-${cfg.slug}}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 64M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${cfg.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3
    volumes:
      - mod-${cfg.slug}-data:/app/data`;

  if (cfg.mountType === "iframe") {
    yaml += `

  # ─── Module Frontend ─────────────────────────────────────────────
  ${cfg.slug}-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "\${FRONTEND_PORT:-3000}:3000"
    environment:
      SERVER_API_BASE_URL: http://mod-${cfg.slug}:${cfg.port}
    depends_on:
      mod-${cfg.slug}:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M`;
  }

  yaml += `

  # ─── PostgreSQL ──────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: viaoceanica
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-viao_db_2024_secure}
      POSTGRES_DB: ${dbName}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U viaoceanica -d ${dbName}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ─── Redis ───────────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "\${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mod-${cfg.slug}-data:
  postgres-data:
  redis-data:
`;

  return yaml;
}

// ─── Production Docker Compose Snippet ────────────────────────────

function dockerComposeSnippet(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  const slugUnder = slugToUnderscore(cfg.slug);
  const dbUrl = cfg.databaseMode === "separate"
    ? `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_${slugUnder}`
    : `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_platform`;

  let yaml = `# ─── Add to the MAIN docker-compose.yml ─────────────────────────
# Copy this block into the "services:" section of the platform's
# docker-compose.yml at /opt/viaoceanica-ai/docker-compose.yml

  mod-${cfg.slug}:
    build:
      context: ./modules/${cfg.slug}
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${cfg.port}"
      DATABASE_URL: ${dbUrl}
      AI_SERVICE_URL: http://ai-service:4010
      AI_AGENT_ID: ${cfg.slug}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${cfg.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3`;

  if (cfg.mountType === "iframe") {
    yaml += `

  ${cfg.slug}-frontend:
    build:
      context: ./modules/${cfg.slug}/frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      SERVER_API_BASE_URL: http://mod-${cfg.slug}:${cfg.port}
    depends_on:
      - mod-${cfg.slug}
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M`;
  }

  yaml += `

# ─── Add to gateway environment: ──────────────────────────────────
# MOD_${keyUpper}_URL: http://mod-${cfg.slug}:${cfg.port}
`;

  return yaml;
}

// ─── Nginx Snippet ────────────────────────────────────────────────

function nginxSnippet(cfg: ScaffoldConfig): string {
  if (cfg.mountType !== "iframe") {
    return `# Módulos com montagem "${cfg.mountType}" não necessitam de configuração nginx adicional.\n`;
  }
  const slugUnder = slugToUnderscore(cfg.slug);
  return `# ─── Add to nginx.conf ──────────────────────────────────────────

upstream ${slugUnder}_frontend {
    server ${cfg.slug}-frontend:3000;
}

# Add inside server block, BEFORE the catch-all location /

location /module/${cfg.slug} {
    proxy_pass http://${slugUnder}_frontend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
`;
}

// ─── .env.example ─────────────────────────────────────────────────

function envExample(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  return `# ─── ${cfg.name} — Environment Variables ────────────────────────
# Copy this file to .env and adjust values as needed.

# Module
MOD_${keyUpper}_PORT=${cfg.port}
NODE_ENV=development

# Database
DATABASE_URL=postgresql://viaoceanica:viao_db_2024_secure@localhost:5432/viaoceanica_platform
POSTGRES_PASSWORD=viao_db_2024_secure
POSTGRES_PORT=5432

# AI / OpenClaw
AI_SERVICE_URL=http://ai-service:4010
AI_AGENT_ID=${cfg.slug}

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379
${cfg.mountType === "iframe" ? `\n# Frontend\nFRONTEND_PORT=3000` : ""}
`;
}

// ─── README ───────────────────────────────────────────────────────

function readmeContent(cfg: ScaffoldConfig): string {
  const keyUpper = slugToUpperEnv(cfg.slug);
  return `# ${cfg.name}

${cfg.description || "Módulo da plataforma Via Oceânica AI."}

## Quick Start

\`\`\`bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start all services (backend + database + redis)
docker compose up -d

# 3. Verify health
curl http://localhost:${cfg.port}/health

# 4. (Optional) Set up the AI assistant
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
\`\`\`

## Estrutura

\`\`\`
modules/${cfg.slug}/
├── docker-compose.yml         # Full compose for standalone dev
├── Dockerfile                 # Backend container build
├── module-manifest.json       # Module registry manifest
├── .env.example               # Environment variables template
├── ${cfg.backendLanguage === "python" ? "main.py                      # FastAPI application" : "src/index.ts                  # Express application"}
├── ${cfg.backendLanguage === "python" ? "ai_client.py                 # OpenClaw AI integration" : "src/ai-client.ts              # OpenClaw AI integration"}
├── ${cfg.backendLanguage === "python" ? "requirements.txt" : "package.json"}
├── agent/
│   ├── SOUL.md                # AI agent personality & expertise
│   └── setup-agent.sh         # OpenClaw agent registration script
${cfg.mountType === "iframe" ? `├── frontend/
│   ├── Dockerfile
│   ├── next.config.js
│   ├── package.json
│   └── app/
│       ├── page.tsx
│       └── layout.tsx` : ""}
└── deploy/
    ├── docker-compose-snippet.yml  # Snippet for main platform compose
    └── nginx-snippet.conf          # Nginx proxy config (if iframe)
\`\`\`

## AI Assistant Integration

This module comes with an OpenClaw AI agent pre-configured. The agent has domain-specific knowledge defined in \`agent/SOUL.md\`.

### How it works

1. **OpenClaw** runs on the VPS as the AI gateway (port 18789)
2. Each module has a dedicated **agent** with specialized knowledge
3. The backend calls OpenClaw via the \`ai_client\` helper
4. Requests are routed to the correct agent based on \`AI_AGENT_ID\`

### Setting up the agent

\`\`\`bash
# On the VPS (where OpenClaw is running):
cd modules/${cfg.slug}
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
\`\`\`

### Customizing the agent

Edit \`agent/SOUL.md\` to change the agent's personality, expertise, and behavior. After editing, re-run the setup script or copy the file to the OpenClaw workspace:

\`\`\`bash
cp agent/SOUL.md /root/openclaw/workspace/agents/${cfg.slug}/SOUL.md
\`\`\`

### Testing the agent

\`\`\`bash
# Via OpenClaw CLI
openclaw agent --agent ${cfg.slug} --message "Olá, teste"

# Via the module's API
curl -X POST http://localhost:${cfg.port}/api/v1/ai/chat \\
  -H "Content-Type: application/json" \\
  -H "x-viao-tenant-id: 1" \\
  -H "x-viao-user-id: 1" \\
  -d '{"message": "Olá, teste de integração"}'
\`\`\`

## Variáveis de Ambiente

| Variável | Descrição | Default |
|----------|-----------|---------|
| \`MOD_${keyUpper}_PORT\` | Porta do backend | ${cfg.port} |
| \`DATABASE_URL\` | Connection string PostgreSQL | — |
| \`AI_SERVICE_URL\` | URL do AI service local-first | http://ai-service:4010 |
| \`AI_AGENT_ID\` | ID do agente OpenClaw | ${cfg.slug} |
| \`REDIS_URL\` | URL do Redis | redis://localhost:6379 |
| \`POSTGRES_PASSWORD\` | Password do PostgreSQL | viao_db_2024_secure |

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| GET | \`/health\` | Health check |
| GET | \`/ready\` | Readiness check |
| GET | \`/api/v1/status\` | Status do módulo |
| POST | \`/api/v1/ai/chat\` | Chat com assistente AI |

## Headers da Plataforma

O gateway injeta os seguintes headers em cada request:

| Header | Descrição |
|--------|-----------|
| \`x-viao-tenant-id\` | ID da empresa/tenant |
| \`x-viao-user-id\` | ID do utilizador |
| \`x-viao-user-role\` | Papel do utilizador |
| \`x-viao-module-key\` | Chave do módulo |

## Deployment to Production

To add this module to the main Via Oceânica platform:

1. Copy the module directory to \`/opt/viaoceanica-ai/modules/${cfg.slug}/\`
2. Merge \`deploy/docker-compose-snippet.yml\` into the main \`docker-compose.yml\`
3. Add \`deploy/nginx-snippet.conf\` to the nginx configuration (if iframe mount)
4. Run \`agent/setup-agent.sh\` to register the OpenClaw agent
5. Rebuild and restart: \`docker compose up -d --build mod-${cfg.slug}\`
`;
}

// ─── Main Generator ───────────────────────────────────────────────

export async function generateScaffoldZip(cfg: ScaffoldConfig): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const buffers: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => buffers.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(buffers)));
    passthrough.on("error", reject);
    archive.on("error", reject);

    archive.pipe(passthrough);

    const base = `modules/${cfg.slug}`;

    // Module manifest
    archive.append(moduleManifest(cfg), { name: `${base}/module-manifest.json` });

    // README
    archive.append(readmeContent(cfg), { name: `${base}/README.md` });

    // .env.example
    archive.append(envExample(cfg), { name: `${base}/.env.example` });

    // Full docker-compose.yml (for standalone dev)
    archive.append(fullDockerCompose(cfg), { name: `${base}/docker-compose.yml` });

    // Backend
    if (cfg.backendLanguage === "python") {
      archive.append(pythonMain(cfg), { name: `${base}/main.py` });
      archive.append(pythonAiClient(cfg), { name: `${base}/ai_client.py` });
      archive.append(pythonRequirements(cfg), { name: `${base}/requirements.txt` });
      archive.append(pythonDockerfile(cfg), { name: `${base}/Dockerfile` });
    } else {
      archive.append(nodejsMain(cfg), { name: `${base}/src/index.ts` });
      archive.append(nodejsAiClient(cfg), { name: `${base}/src/ai-client.ts` });
      archive.append(nodejsPackageJson(cfg), { name: `${base}/package.json` });
      archive.append(`{}`, { name: `${base}/tsconfig.json` });
      archive.append(nodejsDockerfile(cfg), { name: `${base}/Dockerfile` });
    }

    // Frontend (only for iframe mount)
    if (cfg.mountType === "iframe") {
      archive.append(frontendNextConfig(cfg), { name: `${base}/frontend/next.config.js` });
      archive.append(frontendPackageJson(cfg), { name: `${base}/frontend/package.json` });
      archive.append(frontendPage(cfg), { name: `${base}/frontend/app/page.tsx` });
      archive.append(frontendLayout(cfg), { name: `${base}/frontend/app/layout.tsx` });
      archive.append(frontendDockerfile(cfg), { name: `${base}/frontend/Dockerfile` });
    }

    // OpenClaw agent setup
    archive.append(agentSoulMd(cfg), { name: `${base}/agent/SOUL.md` });
    archive.append(agentSetupScript(cfg), { name: `${base}/agent/setup-agent.sh` });

    // Deploy snippets (for merging into main platform compose)
    archive.append(dockerComposeSnippet(cfg), { name: `${base}/deploy/docker-compose-snippet.yml` });
    archive.append(nginxSnippet(cfg), { name: `${base}/deploy/nginx-snippet.conf` });

    archive.finalize();
  });
}
