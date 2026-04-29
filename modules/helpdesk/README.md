# Helpdesk

Módulo da plataforma Via Oceânica AI.

## Quick Start

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start all services (backend + database + redis)
docker compose up -d

# 3. Verify health
curl http://localhost:4001/health

# 4. (Optional) Set up the AI assistant
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
```

## Estrutura

```
modules/helpdesk/
├── docker-compose.yml         # Full compose for standalone dev
├── Dockerfile                 # Backend container build
├── module-manifest.json       # Module registry manifest
├── .env.example               # Environment variables template
├── main.py                      # FastAPI application
├── ai_client.py                 # OpenClaw AI integration
├── requirements.txt
├── agent/
│   ├── SOUL.md                # AI agent personality & expertise
│   └── setup-agent.sh         # OpenClaw agent registration script
├── frontend/
│   ├── Dockerfile
│   ├── next.config.js
│   ├── package.json
│   └── app/
│       ├── page.tsx
│       └── layout.tsx
└── deploy/
    ├── docker-compose-snippet.yml  # Snippet for main platform compose
    └── nginx-snippet.conf          # Nginx proxy config (if iframe)
```

## AI Assistant Integration

This module comes with an OpenClaw AI agent pre-configured. The agent has domain-specific knowledge defined in `agent/SOUL.md`.

### How it works

1. **OpenClaw** runs on the VPS as the AI gateway (port 18789)
2. Each module has a dedicated **agent** with specialized knowledge
3. The backend calls OpenClaw via the `ai_client` helper
4. Requests are routed to the correct agent based on `AI_AGENT_ID`

### Setting up the agent

```bash
# On the VPS (where OpenClaw is running):
cd modules/helpdesk
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
```

### Customizing the agent

Edit `agent/SOUL.md` to change the agent's personality, expertise, and behavior. After editing, re-run the setup script or copy the file to the OpenClaw workspace:

```bash
cp agent/SOUL.md /root/openclaw/workspace/agents/helpdesk/SOUL.md
```

### Testing the agent

```bash
# Via OpenClaw CLI
openclaw agent --agent helpdesk --message "Olá, teste"

# Via the module's API
curl -X POST http://localhost:4001/api/v1/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-viao-tenant-id: 1" \
  -H "x-viao-user-id: 1" \
  -d '{"message": "Olá, teste de integração"}'
```

## Variáveis de Ambiente

| Variável | Descrição | Default |
|----------|-----------|---------|
| `MOD_HELPDESK_PORT` | Porta do backend | 4001 |
| `DATABASE_URL` | Connection string PostgreSQL | — |
| `AI_SERVICE_URL` | URL do OpenClaw gateway | http://host.docker.internal:18789/v1 |
| `AI_AGENT_ID` | ID do agente OpenClaw | helpdesk |
| `REDIS_URL` | URL do Redis | redis://localhost:6379 |
| `POSTGRES_PASSWORD` | Password do PostgreSQL | viao_db_2024_secure |

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| GET | `/ready` | Readiness check |
| GET | `/api/v1/status` | Status do módulo |
| POST | `/api/v1/ai/chat` | Chat com assistente AI |

## Headers da Plataforma

O gateway injeta os seguintes headers em cada request:

| Header | Descrição |
|--------|-----------|
| `x-viao-tenant-id` | ID da empresa/tenant |
| `x-viao-user-id` | ID do utilizador |
| `x-viao-user-role` | Papel do utilizador |
| `x-viao-module-key` | Chave do módulo |

## Deployment to Production

To add this module to the main Via Oceânica platform:

1. Copy the module directory to `/opt/viaoceanica-ai/modules/helpdesk/`
2. Merge `deploy/docker-compose-snippet.yml` into the main `docker-compose.yml`
3. Add `deploy/nginx-snippet.conf` to the nginx configuration (if iframe mount)
4. Run `agent/setup-agent.sh` to register the OpenClaw agent
5. Rebuild and restart: `docker compose up -d --build mod-helpdesk`
