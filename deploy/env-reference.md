# Via Oceânica AI — Environment Variables Reference

## Security

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret for signing JWT session tokens (min 64 chars) | Yes |

## PostgreSQL (Supabase)

| Variable | Description | Required |
|----------|-------------|----------|
| `PLATFORM_DB_URL` | Platform core database connection string | Yes |
| `RESTAURACAO_DB_URL` | Module Restauração database (defaults to PLATFORM_DB_URL) | No |
| `GESTAO_EMAIL_DB_URL` | Module Gestão Email database (defaults to PLATFORM_DB_URL) | No |
| `BILLING_DB_URL` | Billing service database (defaults to PLATFORM_DB_URL) | No |

## AI Provider

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_PROVIDER_API_KEY` | API key for AI provider (e.g., OpenAI) | Yes |
| `AI_PROVIDER_BASE_URL` | Base URL for AI provider API (default: `https://api.openai.com/v1`) | No |

## Redis

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_URL` | Redis connection string (default: `redis://redis:6379` in Docker) | No |

## Domain

| Variable | Description | Required |
|----------|-------------|----------|
| `DOMAIN` | Production domain (e.g., `ai.viaoceanica.com`) | Production only |
