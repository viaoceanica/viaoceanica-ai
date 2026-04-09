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
- [x] Gateway enforcement de módulos desativados (deny path) — /check endpoint + gateway middleware
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
- [x] Auditar /health e /ready: platform-core, gateway, mod-contabilidade todos verificados
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

### Deploy VPS (77.42.95.216)
- [x] Adaptar docker-compose.yml para PostgreSQL local (não Supabase)
- [x] Preparar todos os serviços com código funcional para deploy
- [x] Copiar projeto para VPS e fazer docker compose up
- [x] Verificar todos os containers a funcionar (10/10 healthy)
- [x] Testar endpoints de saúde e funcionalidade

### Conversão Frontend tRPC → REST (via gateway)
- [x] Criar useApi.ts hook (useQuery, useMutation, useDynamicMutation) com paths do gateway
- [x] Converter Dashboard.tsx para REST
- [x] Converter Modules.tsx para REST
- [x] Converter TeamManagement.tsx para REST
- [x] Converter Tokens.tsx para REST
- [x] Converter CompanyProfile.tsx para REST
- [x] Converter SettingsPage.tsx para REST
- [x] Converter UserProfile.tsx para REST
- [x] Converter ModulePage.tsx para REST
- [x] Converter AdminDashboard.tsx para REST
- [x] Converter AdminCompanies.tsx para REST
- [x] Converter AdminTokens.tsx para REST
- [x] Converter AdminModules.tsx para REST
- [x] Converter AdminPlans.tsx para REST
- [x] Converter DashboardLayout.tsx para REST
- [x] Remover tRPC provider do main.tsx
- [x] Adicionar rotas admin no backend: admin/plans, admin/users, admin/companies/:id, admin/companies/:id/tokens, admin/companies/:id/plan, admin/tokens/transactions
- [x] Adicionar rotas auth: change-password, profile GET/PUT
- [x] Fix healthcheck shell container (localhost → 127.0.0.1)
- [x] Rebuild e redeploy shell + platform-core no VPS
- [x] Verificar todas as sub-páginas no VPS (10/10 OK)

### Problemas conhecidos (menores)
- [x] Preços dos planos mostram NaN€/mês (corrigido: usar monthlyPrice em vez de price)
- [x] Plano Custom mostra "Até -1 membros" (corrigido: tratar -1 como ilimitado)

### Integração ViaContab como Módulo Contabilidade
- [x] Copiar backend ViaContab para modules/contabilidade/ no projeto
- [x] Adaptar backend: middleware x-viao-* headers para contexto de tenant (module_main.py wrapper)
- [x] Refatorar rotas de /api/tenants/{tenant_id}/* para /api/v1/* (tenant via middleware)
- [x] Adicionar /health e /ready no root (module contract)
- [x] Configurar database para usar postgres partilhado (nova DB viaoceanica_contabilidade)
- [x] Copiar frontend ViaContab para servir via container separado (contabilidade-frontend, iframe mount)
- [x] Criar página ModulePage para contabilidade no shell (iframe embed com basePath)
- [x] Adicionar mod-contabilidade + qdrant + contabilidade-frontend ao docker-compose.yml
- [x] Gateway já suporta routing dinâmico via /api/module/:moduleKey/*
- [x] Registar módulo contabilidade no registry (SQL direto no postgres)
- [x] Build e deploy no VPS (3 imagens: mod-contabilidade, contabilidade-frontend, shell)
- [x] Verificar módulo contabilidade funcional no VPS (API online, DB ready, OCR 0 ativos)

### Verificação e gaps da integração ViaContab
- [x] Confirmar module_main.py final: todas as rotas /api/v1/* com tenant via x-viao headers (47 rotas verificadas)
- [x] Verificar /health e /ready no root do módulo contabilidade (health OK, ready OK com DB)
- [x] Confirmar DB config: viaoceanica_contabilidade schema inicializado e usado pelo módulo (/ready confirma DB ok)
- [x] Teste end-to-end no VPS: health OK, DB ready, API online, iframe funcional (upload/classificação requer ficheiros reais)

### Correções e melhorias (2026-04-09)
- [x] Fix preços dos planos: usar monthlyPrice (centavos) em vez de price (CompanyProfile, AdminPlans)
- [x] Fix plano Custom: tratar maxMembers=-1 como "Ilimitado" (Dashboard, CompanyProfile, AdminPlans)
- [x] Platform-core /ready com DB ping real (SELECT 1) — remover TODO placeholder
- [x] Entitlements /check endpoint para gateway enforcement (GET /api/v1/entitlements/check?tenantId=X&moduleKey=Y)
- [x] Gateway module enforcement middleware: verificar entitlement antes de proxy para módulo (fail-open)
- [x] Auditoria /health e /ready verificada em todos os serviços: gateway, platform-core, mod-contabilidade
- [x] Deploy e verificação no VPS: todos os 3 serviços reconstruídos e healthy

### Redesign ViaContab para match dashboard look and feel
- [x] Analisar design do dashboard (cores, fontes, espaçamento, cards, sidebar)
- [x] Analisar design atual do ViaContab frontend
- [x] Reescrever page.tsx do ViaContab com novo design alinhado ao dashboard (header branding atualizado)
- [x] Atualizar globals.css do ViaContab para usar paleta Via Oceânica (teal/green primary, light bg, subtle shadows)
- [x] Rebuild e deploy contabilidade-frontend no VPS
- [x] Verificar novo design no VPS (Upload, Queue, Search tabs — todas OK)
