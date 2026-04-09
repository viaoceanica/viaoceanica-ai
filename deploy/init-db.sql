-- Via Oceânica AI — Database Initialization
-- This file runs once when the PostgreSQL container is first created.


-- ─── Enums ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE platform_role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE company_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE token_type AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE token_source AS ENUM ('admin_grant', 'plan_allocation', 'usage', 'refund', 'external', 'purchase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE module_status AS ENUM ('active', 'maintenance', 'deprecated', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE visibility_mode AS ENUM ('global', 'restricted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE rollout_state AS ENUM ('enabled', 'disabled', 'beta');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  monthly_price INTEGER DEFAULT 0,
  yearly_price INTEGER DEFAULT 0,
  tokens_per_month INTEGER DEFAULT 0,
  max_members INTEGER DEFAULT 5,
  max_teams INTEGER DEFAULT 1,
  max_modules INTEGER DEFAULT 2,
  features JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(100),
  email VARCHAR(320),
  phone VARCHAR(50),
  address TEXT,
  website VARCHAR(500),
  plan_id INTEGER REFERENCES plans(id),
  tokens_balance INTEGER NOT NULL DEFAULT 0,
  external_tokens_balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  name VARCHAR(255),
  password_hash TEXT,
  login_method VARCHAR(64) DEFAULT 'email',
  platform_role platform_role NOT NULL DEFAULT 'user',
  company_id INTEGER REFERENCES companies(id),
  company_role company_role,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_signed_in TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  team_id INTEGER REFERENCES teams(id),
  email VARCHAR(320) NOT NULL,
  role company_role DEFAULT 'member',
  token VARCHAR(64) NOT NULL UNIQUE,
  status invitation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  type token_type NOT NULL,
  source token_source NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT,
  module_key VARCHAR(100),
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS module_registry (
  id SERIAL PRIMARY KEY,
  module_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version VARCHAR(20) DEFAULT '1.0.0',
  route VARCHAR(255),
  frontend_mount_type VARCHAR(50) DEFAULT 'internal',
  backend_service_url VARCHAR(500),
  health_endpoint VARCHAR(255) DEFAULT '/health',
  readiness_endpoint VARCHAR(255) DEFAULT '/ready',
  icon VARCHAR(100),
  status module_status NOT NULL DEFAULT 'active',
  capabilities JSONB,
  min_plan VARCHAR(100),
  tenant_restricted BOOLEAN DEFAULT false,
  config_schema JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_modules (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES companies(id),
  module_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  visibility_mode visibility_mode DEFAULT 'global',
  rollout_state rollout_state DEFAULT 'enabled',
  config JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_module_unique ON tenant_modules(tenant_id, module_key);

CREATE TABLE IF NOT EXISTS module_permissions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES companies(id),
  module_key VARCHAR(100) NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── AI Usage Events ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES companies(id),
  module_key VARCHAR(100),
  user_id INTEGER REFERENCES users(id),
  provider VARCHAR(50) NOT NULL DEFAULT 'openai',
  model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(10,6) DEFAULT 0,
  request_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Seed: Plans ────────────────────────────────────────────────────

INSERT INTO plans (name, description, monthly_price, yearly_price, tokens_per_month, max_members, max_teams, max_modules, features, sort_order)
VALUES
  ('Starter', 'Plano inicial para pequenas empresas. Ideal para começar a explorar a plataforma.', 0, 0, 1000, 3, 1, 2, '{"support": "email"}', 1),
  ('Professional', 'Para empresas em crescimento que precisam de mais recursos e funcionalidades.', 4900, 49000, 10000, 10, 5, 5, '{"support": "priority", "analytics": true}', 2),
  ('Enterprise', 'Para grandes organizações com necessidades avançadas de personalização.', 14900, 149000, 100000, 50, 20, -1, '{"support": "dedicated", "analytics": true, "sla": true, "custom_branding": true}', 3),
  ('Custom', 'Plano personalizado. Contacte-nos para uma proposta à medida.', 0, 0, 0, -1, -1, -1, '{"support": "dedicated", "custom": true}', 4)
ON CONFLICT DO NOTHING;

-- ─── Seed: Module Registry ──────────────────────────────────────────

INSERT INTO module_registry (module_key, name, description, version, route, frontend_mount_type, backend_service_url, health_endpoint, readiness_endpoint, icon, status, capabilities, tenant_restricted)
VALUES
  ('restauracao', 'Restauração', 'Módulo de gestão para restauração — menus, reservas, inventário, assistente IA.', '1.0.0', '/module/restauracao', 'internal', 'http://mod-restauracao:4001', '/health', '/ready', 'UtensilsCrossed', 'active', '["ai","storage"]', false),
  ('gestao-email', 'Gestão Email', 'Módulo de gestão de email — campanhas, listas, templates, automações.', '1.0.0', '/module/gestao-email', 'internal', 'http://mod-gestao-email:4002', '/health', '/ready', 'Mail', 'active', '["ai","email"]', false),
  ('contabilidade', 'Contabilidade', 'Importação e classificação de faturas com IA — upload de documentos, extração automática, pesquisa semântica e análise de custos.', '1.0.0', '/module/contabilidade', 'iframe', 'http://mod-contabilidade:4003', '/health', '/ready', 'Receipt', 'active', '["ai","storage"]', false)
ON CONFLICT (module_key) DO NOTHING;

-- ─── Create platform admin user (password: admin123) ────────────────
-- bcrypt hash for 'admin123' with 12 rounds
INSERT INTO users (email, name, password_hash, login_method, platform_role, last_signed_in)
VALUES ('admin@viaoceanica.com', 'Admin Via Oceânica', '$2a$12$LJ3m4ys3Gz8y0Gv3gZ5tXOQqYqKzV5L8Hs7nN3mM9pP0qR2sT4uW', 'email', 'admin', NOW())
ON CONFLICT (email) DO NOTHING;
