# Project TODO

- [x] Schema da base de dados (empresas, utilizadores, equipas, membros, planos, tokens, módulos)
- [x] Sistema de autenticação próprio (email/password) — registo, login, logout
- [ ] Recuperação de password (placeholder criado — requer serviço de email, fase futura)
- [x] Tema claro como padrão com paleta Via Oceânica (verde-água #00FFAC, amarelo #FFB800, fundo claro)
- [x] Landing page pública
- [x] Página de registo de empresa (email/password)
- [x] Página de login
- [x] Página de recuperação de password
- [x] Dashboard empresarial (visão geral: tokens, equipa, plano ativo)
- [x] Visualização de tokens internos e externos (interface gráfica)
- [x] Gestão de equipas (criar equipas, convidar membros por email)
- [x] Remover membros da empresa e alterar papéis na UI
- [x] Gestão de conta empresarial (editar perfil, visualizar planos)
- [x] Upgrade/downgrade de plano funcional via admin (admin atribui plano; empresa contacta admin)
- [ ] Secções de faturação e preferências (fase futura — não incluído nesta versão)
- [x] Planos de subscrição (Starter, Professional, Enterprise, Custom) — geridos via backend
- [x] Configurador modular (ativar/desativar módulos: Restauração, Gestão Email) — apenas interface gráfica
- [x] Painel de administração: lista de empresas, atribuir tokens gratuitos, gerir planos, monitorização global
- [x] Admin: visualização de tokens totais e por empresa, e por módulo
- [x] Testes vitest (21 testes a passar)
- [x] Página de perfil de utilizador (informações pessoais, atividade recente)
- [x] Reorganizar sidebar: Dashboard como item principal, restantes (Equipa, Módulos, Tokens, Empresa, Perfil, Segurança) como sub-menus de Definições
- [x] Bug: sub-menu Definições abre automaticamente ao aceder ao Dashboard — deve iniciar fechado
- [x] Módulos ativos aparecem como itens na sidebar (abaixo do Dashboard, acima de Definições)
- [x] Ao ativar módulo, abre painel de gestão de permissões (equipas e membros)
- [x] Proprietário define que equipas e membros acedem a cada módulo
- [x] Validar que todos os módulos ativos aparecem na sidebar (incluindo Gestão Email quando ativo)
- [x] Enforcement de permissões no acesso a /dashboard/module/:slug (bloquear sem permissão)
- [x] Testes vitest para rotas de permissões de módulos (28 testes a passar)
- [x] Validar no UI que Gestão Email ativo aparece na sidebar
- [x] Enforcement de permissões no backend (server-side) para módulos (getActiveModulesForUser verifica owner/admin, equipas e permissões individuais)

## Reestruturação Arquitetural (baseada em viaoceanica_architecture_notes.md)

### Fase 1: Reorganizar código — module contracts e estrutura multi-container
- [x] Definir estrutura de pastas multi-container (shell, gateway, platform-core, modules/restauracao, modules/gestao-email)
- [x] Criar Module Contract v1 (manifest schema JSON, API contract, health/readiness, auth context, observability)
- [x] Criar module manifest schema (module_key, name, version, route, frontend_mount_type, backend_service_url, status)
- [x] Separar shell frontend (React + TypeScript) como container independente (Dockerfile + nginx.conf)
- [x] Separar platform-core (auth, RBAC, tenant model, module registry, audit) como serviço independente
- [x] Extrair módulos de negócio (Restauração, Gestão Email) para containers independentes com APIs próprias

### Fase 2: Gateway/BFF pattern e module registry
- [x] Implementar API gateway/reverse proxy (routing, auth enforcement, header forwarding, rate limiting)
- [x] Definir e implementar headers x-viao-* (user-id, tenant-id, session-id, platform-roles, module-entitlements, request-id)
- [x] Implementar module registry centralizado na base de dados (modules, tenant_modules, tenant_module_settings)
- [x] Shell consome module manifest do registry para construir navegação dinâmica (DashboardLayout existente; integração com novo registry por completar)
- [x] Gateway routing e header injection implementados
- [ ] Gateway enforcement de módulos desativados (deny path) — por completar com testes
- [x] Tenant entitlements: módulos por tenant com suporte a global, plan-based, tenant-specific e beta

### Fase 3: Migrar para PostgreSQL (Supabase)
- [x] Configurar Supabase como provider PostgreSQL (schema + drizzle config criados)
- [x] Estrutura para bases de dados separadas por concern (env vars no docker-compose)
- [ ] Provisionar e migrar bases de dados separadas no Supabase
- [x] Migrar schema de users, companies, teams, plans, module_registry para platform_db (PostgreSQL schema completo)
- [x] Billing service scaffold criado
- [ ] Implementar schema billing_db e executar migrações
- [x] Estrutura preparada para schemas por módulo
- [ ] Criar schemas específicos para restauracao_db e gestao_email_db
- [x] Adaptar ORM/queries para PostgreSQL (Drizzle com driver pg/postgres)
- [x] Implementar tenant_id em todas as tabelas tenant-scoped com guardrails de isolamento

### Fase 4: Serviço AI centralizado com metering
- [x] AI service scaffold criado (endpoints, metering structure, health/ready)
- [ ] Completar integração com provider AI real (remover TODOs/placeholders)
- [ ] Implementar tabela raw AI usage events (usage_event_id, tenant_id, module_key, user_id, provider, model, tokens, cost, etc.)
- [ ] Implementar tabela aggregated billing summaries (por tenant, module, provider, model, período)
- [x] Arquitetura definida para módulos chamarem AI service
- [ ] Implementar chamadas reais dos módulos ao ai-service
- [ ] Metering obrigatório: cada chamada AI emite raw usage event
- [ ] Dashboard de consumo AI por tenant e por módulo

### Fase 5: Docker Compose, Redis e deployment
- [x] Criar Dockerfiles para cada serviço (shell, gateway, platform-core, ai-service, billing, cada módulo)
- [x] Criar docker-compose.yml completo (shell, gateway, platform-core, ai-service, billing, Redis, módulos, nginx)
- [x] Configurar Redis para cache, rate limiting, session helpers e background jobs (redis container + env vars)
- [x] Configurar reverse proxy (nginx) em frente ao gateway (nginx.conf + rate limiting)
- [x] Health checks e readiness checks nos containers principais
- [ ] Auditar e completar /health e /ready em todos os serviços
- [ ] CPU/memory limits definidos por container
- [ ] CI/CD baseline para build e deploy independente de cada serviço
- [x] Documentação de environment variables (deploy/env-reference.md)
- [ ] Implementar estratégia concreta de gestão de secrets (Docker secrets ou .env injection)

### Fase 6: Documentação e entrega
- [ ] Architecture Decision Records (ADRs) formais
- [x] Documentação do module contract e manifest schema (contracts/)
- [x] Documentação de arquitetura e docker-compose.yml
- [ ] Expandir para runbook de deployment executável (prereqs, migrações, TLS, rollback)
- [x] Guia de onboarding de novos módulos (ARCHITECTURE.md — "Adding a New Module")
