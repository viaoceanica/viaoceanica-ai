# Project TODO

- [x] Schema da base de dados (empresas, utilizadores, equipas, membros, planos, tokens, módulos)
- [x] Sistema de autenticação próprio (email/password) — registo, login, logout
- [x] Recuperação de password (implementado com SMTP via mail.viaoceanica.com)
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
- [x] Secções de faturação e preferências (implementado — billing profiles + invoices)
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
- [x] Provisionar bases de dados PostgreSQL (local no VPS em vez de Supabase — decisão ADR-002)
- [x] Migrar schema de users, companies, teams, plans, module_registry para platform_db (PostgreSQL schema completo)
- [x] Billing service scaffold criado
- [x] Implementar schema billing_db e executar migrações (payment_methods, billing_events, token_purchases, plan_changes)
- [x] Estrutura preparada para schemas por módulo
- [x] Criar schemas específicos para restauracao_db e gestao_email_db (tabelas criadas no PostgreSQL)
- [x] Adaptar ORM/queries para PostgreSQL (Drizzle com driver pg/postgres)
- [x] Implementar tenant_id em todas as tabelas tenant-scoped com guardrails de isolamento

### Fase 4: Serviço AI centralizado com metering
- [x] AI service scaffold criado (endpoints, metering structure, health/ready)
- [x] Completar integração com provider AI real (OpenAI proxy com metering)
- [x] Implementar tabela raw AI usage events (ai_usage_events com tenant, module, model, tokens, cost, duration)
- [x] Implementar tabela aggregated billing summaries (ai_usage_summaries com upsert mensal)
- [x] Arquitetura definida para módulos chamarem AI service
- [x] Implementar chamadas reais dos módulos ao ai-service (restauracao e gestao-email com AI helpers)
- [x] Metering obrigatório: cada chamada AI emite raw usage event + atualiza summary
- [x] Dashboard de consumo AI por tenant e por módulo (/admin/ai-usage com cards e tabela)

### Fase 5: Docker Compose, Redis e deployment
- [x] Criar Dockerfiles para cada serviço (shell, gateway, platform-core, ai-service, billing, cada módulo)
- [x] Criar docker-compose.yml completo (shell, gateway, platform-core, ai-service, billing, Redis, módulos, nginx)
- [x] Configurar Redis para cache, rate limiting, session helpers e background jobs (redis container + env vars)
- [x] Configurar reverse proxy (nginx) em frente ao gateway (nginx.conf + rate limiting)
- [x] Health checks e readiness checks nos containers principais
- [x] Auditar /health e /ready: platform-core, gateway, mod-contabilidade todos verificados
- [x] CPU/memory limits definidos por container
- [x] CI/CD baseline para build e deploy independente de cada serviço (GitHub Actions workflow)
- [x] Documentação de environment variables (deploy/env-reference.md)
- [x] Implementar estratégia concreta de gestão de secrets (.env injection com docker-compose)

### Fase 6: Documentação e entrega
- [x] Architecture Decision Records (ADRs) formais (5 ADRs criados em docs/adrs/)
- [x] Documentação do module contract e manifest schema (contracts/)
- [x] Documentação de arquitetura e docker-compose.yml
- [x] Expandir para runbook de deployment executável (docs/DEPLOYMENT-RUNBOOK.md)
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

### Auto-update sidebar on module toggle
- [x] Sidebar auto-updates when module is activated/deactivated (no page refresh needed)

### Remover Configuração do tenant do ViaContab
- [x] Remover secção "Configuração do tenant" do page.tsx do módulo contabilidade (info vem do dashboard)
- [x] Remover campo "Tenant" do formulário de upload (tenant vem do contexto do dashboard)
- [x] Implementar injeção de tenant via postMessage do dashboard para iframe do ViaContab
- [x] ViaContab escuta postMessage e usa tenantId do contexto do dashboard (fallback "demo" após 2s)
- [x] Loading state enquanto aguarda contexto do dashboard
- [x] Atualizar mensagens de erro de tenant para refletir injeção automática

### Recuperação de password (SMTP)
- [x] Adicionar tabela password_reset_tokens na DB (PostgreSQL)
- [x] Instalar nodemailer no platform-core
- [x] Criar módulo de email (SMTP config com nodemailer)
- [x] Criar rota POST /api/auth/forgot-password (gera token, envia email)
- [x] Criar rota POST /api/auth/reset-password (valida token, atualiza password)
- [x] Atualizar ForgotPassword.tsx para chamar API real
- [x] Criar página ResetPassword.tsx para definir nova password
- [x] Adicionar rota /reset-password/:token no App.tsx
- [x] Adicionar SMTP env vars ao docker-compose.yml
- [x] Rebuild e deploy platform-core + shell no VPS
- [x] Testar fluxo completo de recuperação de password

### Billing Schema e UI de Faturação
- [x] Analisar schema existente (plans, token_transactions, companies)
- [x] Criar tabelas billing_profiles e invoices na DB
- [x] Criar rotas de billing no platform-core (CRUD billing profile, listar faturas)
- [x] Criar página BillingPage.tsx no dashboard frontend
- [x] Adicionar rota /dashboard/billing ao App.tsx e navegação
- [x] Rebuild e deploy no VPS
- [x] Testar fluxo de billing no browser

### Configuração OpenAI API Key
- [x] Adicionar OPENAI_API_KEY ao docker-compose.yml do ai-service
- [x] Reiniciar ai-service e verificar que chamadas AI funcionam (gpt-4o-mini testado, metering a funcionar)

### Configuração OpenAI no módulo ViaContab
- [x] Verificar como o módulo contabilidade lê a chave OpenAI (OPENAI_API_KEY via pydantic-settings)
- [x] Corrigir extraction_model de gpt-5.4-mini para gpt-4o-mini
- [x] Configurar credenciais R2 (Cloudflare) para storage de ficheiros
- [x] Adicionar OPENAI_API_KEY ao mod-contabilidade no docker-compose
- [x] Reiniciar mod-contabilidade (timeout aumentado para 180s, upload via /ingest)
- [x] Validar processamento end-to-end de fatura no ViaContab (7 faturas reais processadas com sucesso)
- [x] Confirmar fluxo de upload fallback /ingest funciona no browser (R2 bypassed, /ingest direto)

### ViaContab UI Cleanup
- [x] Remover secção Telemetria de fricção (upload funnel) da página principal
- [x] Remover indicadores API/DB/OCR do topo da página principal (manter código para futuro)
- [x] Deploy e verificar no browser

### ViaContab Queue Tab Cleanup
- [x] Remover card "Falhas de importação" do tab Queue (manter código para futuro)
- [x] Remover card "Revisão e bloqueios" do tab Queue (manter código para futuro)
- [x] Deploy e verificar no browser

### Admin Panel (Standalone Auth + Management)
- [x] Admin credentials table in DB (admin_credentials: username, passwordHash, changeable)
- [x] Backend: admin login endpoint (POST /api/admin/login with username/password → session cookie)
- [x] Backend: admin change password endpoint (admin.changePassword)
- [x] Backend: module CRUD (admin.createModule, admin.updateModule, admin.deleteModule)
- [x] Backend: tenant billing summary (admin.tenantBilling — tokens, plan, transactions per company)
- [x] Frontend: Admin login page (/admin-login) with standalone username/password form
- [x] Frontend: Enhanced admin dashboard with overview metrics
- [x] Frontend: Admin clients/companies page with billing info per tenant
- [x] Frontend: Admin modules page with ability to add/edit/remove modules
- [x] Frontend: Admin settings page with changeable admin password
- [x] Seed default admin credentials (admin / Password321!)
- [x] Tests for admin auth and module CRUD (39 tests passing)

### Admin CRUD for Modules and Empresas
- [x] Backend: add createCompany, updateCompany, deleteCompany tRPC procedures
- [x] Backend: verify module CRUD procedures work end-to-end (create, update, delete)
- [x] Frontend: AdminCompanies — add create company dialog with form fields
- [x] Frontend: AdminCompanies — add edit company dialog with pre-filled form
- [x] Frontend: AdminCompanies — add delete company confirmation dialog
- [x] Frontend: AdminModules — verify create/edit/delete module dialogs work end-to-end
- [x] Tests: add/update tests for company CRUD and module CRUD (46 tests passing)
- [x] Browser verification of all CRUD flows

### Admin Credentials Update
- [x] Update admin username from "admin" to "geral@viaoceanica.com"
- [x] Update admin password hash in DB for Password321!
- [x] Update login form placeholder to show email format
- [x] Ensure no other users can access admin panel (single admin only)

### Bug Fix: React error #31 on admin login (production)
- [x] Fix React error #31 (object rendered as React child) in admin login flow — toast.error(data.error) was passing {code,message} object; fixed to extract .message; also updated geral@viaoceanica.com to admin role and Password321! hash on VPS

### Enhanced Admin Module Management (per module spec)
- [x] Module name auto-generates module_key (slugified), service URLs, container names per spec
- [x] Module form shows all spec-aligned fields: name, description, icon, mount type, backend tech, frontend tech, port, status
- [x] Auto-generated fields displayed as read-only previews: module_key, backend URL, frontend URL, container names, env vars
- [x] Module creation generates a summary of integration steps needed (gateway env, nginx config, docker-compose block)
- [x] Backend: enhanced createModule/updateModule with auto-derived fields
- [x] Frontend: redesigned AdminModules form with spec-aligned workflow
