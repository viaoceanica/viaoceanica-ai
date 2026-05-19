# Email

Módulo full-stack da plataforma Via Oceânica AI para operação de email.

## Incluído neste scaffold

- Backend FastAPI multi-tenant
- Frontend Next.js em iframe
- Assistente AI dedicado ao módulo
- Catálogo inicial de mailboxes, campanhas e automações
- Worker de sync IMAP em background
- Snippets de deploy para compose e nginx

## Quick start

```bash
cp .env.example .env
docker compose up -d
curl http://localhost:4004/health
```

## Estrutura

```text
modules/email/
├── docker-compose.yml
├── Dockerfile
├── module-manifest.json
├── .env.example
├── main.py
├── ai_client.py
├── requirements.txt
├── agent/
│   ├── SOUL.md
│   └── setup-agent.sh
├── frontend/
│   ├── Dockerfile
│   ├── next.config.js
│   ├── package.json
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       └── page.tsx
└── deploy/
    ├── docker-compose-snippet.yml
    └── nginx-snippet.conf
```

## Primeira vertical slice

Este scaffold já expõe:

- `GET /api/v1/dashboard`
- `GET/POST /api/v1/mailboxes`
- `POST /api/v1/mailboxes/:id/sync`
- `GET /api/v1/mailboxes/:id/folders`
- `GET /api/v1/emails`
- `POST /api/v1/emails/:id/actions`
- `GET/POST /api/v1/campaigns`
- `GET/POST /api/v1/automations`
- `POST /api/v1/ai/chat`

## Próximos passos recomendados

1. Ajustar `EMAIL_SYNC_INTERVAL_SECONDS` conforme a carga desejada do polling.
2. Adicionar mais ações IMAP, por exemplo marcar com estrela ou criar regras automáticas de routing.
3. Trocar os dados seeded por entidades reais do domínio.
4. Registar o módulo na plataforma e ativá-lo para tenants de teste.
