# Módulo Social Media — Via Oceânica AI

Independent module for planning, generating, approving, scheduling and manually exporting social media posts with AI support.

## Scope

This implementation intentionally stays inside `modules/social-media` only. It does **not** modify the platform shell, gateway, root Docker Compose, registry, billing or any existing module.

## Revert

A git tag was created before module creation. To remove only this module:

```bash
rm -rf modules/social-media
git tag --list 'pre-social-media-module-*'
```

If a broader rollback is required, reset to the recorded pre-module tag after confirming unrelated dirty changes are not needed.

## Runtime contract

- Backend: FastAPI, `mod-social-media`, port `4005`.
- Frontend: Next.js iframe-compatible UI at `/module/social-media`, port `3005` in local compose.
- Business APIs: `/api/v1/*`.
- Required public endpoints: `/health`, `/ready`.
- Auth: no local login; business routes require trusted `x-viao-*` headers from the platform gateway.
- AI: module calls the central `AI_SERVICE_URL`; it does not call model providers directly. `AI_MODEL` defaults to `ollama/qwen2.5:14b-instruct`, matching the LiteLLM/Ollama path used by the platform.
- UI/copy/prompts: Portuguese Portugal (PT-PT).
- v1 intentionally excludes automatic publishing to social networks.

## Local tests

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt -r requirements-dev.txt
DATABASE_URL='sqlite+pysqlite:///:memory:' PYTHONPATH=. pytest -q tests
```

## Local runtime smoke

```bash
DATABASE_URL='sqlite+pysqlite:///./social_media_dev.db' ALLOW_DEMO_TENANT=true PYTHONPATH=. uvicorn main:app --host 127.0.0.1 --port 4005
curl -fsS http://127.0.0.1:4005/health
curl -fsS http://127.0.0.1:4005/ready
```

## Module-local Docker Compose

```bash
docker compose config
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:4005/health
curl -fsS http://127.0.0.1:4005/ready
docker compose down -v
```

## Platform integration later

When the user explicitly approves platform changes, register the manifest, add gateway env vars, add shell iframe mapping, and add root compose services. Those are deliberately not included here.
