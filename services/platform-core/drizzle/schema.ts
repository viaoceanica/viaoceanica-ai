/**
 * Via Oceânica AI — Platform Core Database Schema (PostgreSQL / Supabase)
 *
 * This schema covers:
 * - Users & authentication
 * - Companies (tenants)
 * - Teams & team members
 * - Invitations
 * - Plans & subscriptions
 * - Token transactions
 * - Module registry
 * - Tenant module entitlements
 * - Module permissions (per team/user)
 */

import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────

export const platformRoleEnum = pgEnum("platform_role", ["user", "admin"]);
export const companyRoleEnum = pgEnum("company_role", ["owner", "admin", "member"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "expired"]);
export const tokenTypeEnum = pgEnum("token_type", ["credit", "debit"]);
export const tokenSourceEnum = pgEnum("token_source", [
  "admin_grant",
  "plan_allocation",
  "usage",
  "refund",
  "external",
  "purchase",
]);
export const moduleStatusEnum = pgEnum("module_status", ["active", "maintenance", "deprecated", "disabled"]);
export const visibilityModeEnum = pgEnum("visibility_mode", ["global", "restricted"]);
export const rolloutStateEnum = pgEnum("rollout_state", ["enabled", "disabled", "beta"]);

// ─── Plans ──────────────────────────────────────────────────────────

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  monthlyPrice: integer("monthly_price").default(0),
  yearlyPrice: integer("yearly_price").default(0),
  tokensPerMonth: integer("tokens_per_month").default(0),
  maxMembers: integer("max_members").default(5),
  maxTeams: integer("max_teams").default(1),
  maxModules: integer("max_modules").default(2),
  features: jsonb("features"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Companies (Tenants) ────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  sector: varchar("sector", { length: 100 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  website: varchar("website", { length: 500 }),
  planId: integer("plan_id").references(() => plans.id),
  tokensBalance: integer("tokens_balance").default(0).notNull(),
  externalTokensBalance: integer("external_tokens_balance").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Users ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash"),
  loginMethod: varchar("login_method", { length: 64 }).default("email"),
  platformRole: platformRoleEnum("platform_role").default("user").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  companyRole: companyRoleEnum("company_role"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

// ─── Teams ──────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Team Members ───────────────────────────────────────────────────

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: varchar("role", { length: 50 }).default("member"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

// ─── Invitations ────────────────────────────────────────────────────

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  teamId: integer("team_id").references(() => teams.id),
  email: varchar("email", { length: 320 }).notNull(),
  role: companyRoleEnum("role").default("member"),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: invitationStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Token Transactions ─────────────────────────────────────────────

export const tokenTransactions = pgTable("token_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  type: tokenTypeEnum("type").notNull(),
  source: tokenSourceEnum("source").notNull(),
  amount: integer("amount").notNull(),
  description: text("description"),
  moduleKey: varchar("module_key", { length: 100 }),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Module Registry ────────────────────────────────────────────────

export const moduleRegistry = pgTable("module_registry", {
  id: serial("id").primaryKey(),
  moduleKey: varchar("module_key", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  version: varchar("version", { length: 20 }).default("1.0.0"),
  route: varchar("route", { length: 255 }),
  frontendMountType: varchar("frontend_mount_type", { length: 50 }).default("internal"),
  backendServiceUrl: varchar("backend_service_url", { length: 500 }),
  healthEndpoint: varchar("health_endpoint", { length: 255 }).default("/health"),
  readinessEndpoint: varchar("readiness_endpoint", { length: 255 }).default("/ready"),
  icon: varchar("icon", { length: 100 }),
  status: moduleStatusEnum("status").default("active").notNull(),
  capabilities: jsonb("capabilities"),
  minPlan: varchar("min_plan", { length: 100 }),
  tenantRestricted: boolean("tenant_restricted").default(false),
  configSchema: jsonb("config_schema"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Tenant Module Entitlements ─────────────────────────────────────

export const tenantModules = pgTable(
  "tenant_modules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => companies.id).notNull(),
    moduleKey: varchar("module_key", { length: 100 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    visibilityMode: visibilityModeEnum("visibility_mode").default("global"),
    rolloutState: rolloutStateEnum("rollout_state").default("enabled"),
    config: jsonb("config"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    tenantModuleUnique: uniqueIndex("tenant_module_unique").on(table.tenantId, table.moduleKey),
  })
);

// ─── Module Permissions (per team/user) ─────────────────────────────

export const modulePermissions = pgTable("module_permissions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => companies.id).notNull(),
  moduleKey: varchar("module_key", { length: 100 }).notNull(),
  teamId: integer("team_id").references(() => teams.id),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Type Exports ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type ModuleRegistryEntry = typeof moduleRegistry.$inferSelect;
export type TenantModule = typeof tenantModules.$inferSelect;
export type ModulePermission = typeof modulePermissions.$inferSelect;

// ─── Password Reset Tokens ─────────────────────────────────────────

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ─── Billing Enums ─────────────────────────────────────────────────

export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "pending", "paid", "overdue", "cancelled"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["bank_transfer", "credit_card", "mbway", "multibanco", "paypal", "other"]);
export const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "yearly"]);

// ─── Billing Profiles ──────────────────────────────────────────────

export const billingProfiles = pgTable("billing_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull().unique(),
  legalName: varchar("legal_name", { length: 255 }),
  nif: varchar("nif", { length: 20 }),
  address: text("address"),
  postalCode: varchar("postal_code", { length: 20 }),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Portugal"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  preferredPaymentMethod: paymentMethodTypeEnum("preferred_payment_method").default("bank_transfer"),
  billingCycle: billingCycleEnum("billing_cycle").default("monthly"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Invoices ──────────────────────────────────────────────────────

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  billingCycle: billingCycleEnum("billing_cycle").default("monthly"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  subtotal: integer("subtotal").default(0).notNull(),
  taxRate: integer("tax_rate").default(23),
  taxAmount: integer("tax_amount").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  currency: varchar("currency", { length: 3 }).default("EUR"),
  planName: varchar("plan_name", { length: 100 }),
  planId: integer("plan_id").references(() => plans.id),
  lineItems: jsonb("line_items"),
  paidAt: timestamp("paid_at"),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Billing Type Exports ──────────────────────────────────────────

export type BillingProfile = typeof billingProfiles.$inferSelect;
export type InsertBillingProfile = typeof billingProfiles.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;
