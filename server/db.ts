import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  InsertCompany, companies,
  InsertTeam, teams,
  InsertTeamMember, teamMembers,
  InsertInvitation, invitations,
  plans,
  modules,
  companyModules,
  InsertCompanyModule,
  tokenTransactions,
  InsertTokenTransaction,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = 'admin';
    updateSet.role = 'admin';
  }
  if (user.companyId !== undefined) {
    values.companyId = user.companyId;
    updateSet.companyId = user.companyId;
  }
  if (user.companyRole !== undefined) {
    values.companyRole = user.companyRole;
    updateSet.companyRole = user.companyRole;
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createUser(data: { email: string; name: string; passwordHash: string; companyId?: number; companyRole?: "owner" | "admin" | "member" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const openId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(users).values({
    openId,
    email: data.email,
    name: data.name,
    passwordHash: data.passwordHash,
    loginMethod: "email",
    role: "user",
    companyId: data.companyId,
    companyRole: data.companyRole || "member",
    lastSignedIn: new Date(),
  });
  return getUserByEmail(data.email);
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

// ─── Companies ───────────────────────────────────────────────────────

export async function createCompany(data: InsertCompany) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(companies).values(data);
  const id = result[0].insertId;
  return getCompanyById(id);
}

export async function getCompanyById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateCompany(id: number, data: Partial<InsertCompany>) {
  const db = await getDb();
  if (!db) return;
  await db.update(companies).set(data).where(eq(companies.id, id));
}

export async function getAllCompanies() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companies);
}

export async function getCompanyMembers(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.companyId, companyId));
}

// ─── Teams ───────────────────────────────────────────────────────────

export async function createTeam(data: InsertTeam) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teams).values(data);
  const id = result[0].insertId;
  return getTeamById(id);
}

export async function getTeamById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getTeamsByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teams).where(eq(teams.companyId, companyId));
}

export async function deleteTeam(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(teamMembers).where(eq(teamMembers.teamId, id));
  await db.delete(teams).where(eq(teams.id, id));
}

// ─── Team Members ────────────────────────────────────────────────────

export async function addTeamMember(data: InsertTeamMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(teamMembers).values(data);
}

export async function getTeamMembers(teamId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
}

export async function removeTeamMember(teamId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}

// ─── Invitations ─────────────────────────────────────────────────────

export async function createInvitation(data: InsertInvitation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(invitations).values(data);
}

export async function getInvitationByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getPendingInvitationsByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invitations).where(and(eq(invitations.companyId, companyId), eq(invitations.status, "pending")));
}

export async function updateInvitationStatus(id: number, status: "pending" | "accepted" | "expired") {
  const db = await getDb();
  if (!db) return;
  await db.update(invitations).set({ status }).where(eq(invitations.id, id));
}

// ─── Plans ───────────────────────────────────────────────────────────

export async function getAllPlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(plans);
}

export async function getPlanById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Modules ─────────────────────────────────────────────────────────

export async function getAllModules() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(modules);
}

export async function getCompanyModules(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companyModules).where(eq(companyModules.companyId, companyId));
}

export async function setCompanyModule(data: InsertCompanyModule) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if exists
  const existing = await db.select().from(companyModules)
    .where(and(eq(companyModules.companyId, data.companyId), eq(companyModules.moduleId, data.moduleId)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(companyModules).set({ isEnabled: data.isEnabled }).where(eq(companyModules.id, existing[0].id));
  } else {
    await db.insert(companyModules).values(data);
  }
}

// ─── Token Transactions ──────────────────────────────────────────────

export async function addTokenTransaction(data: InsertTokenTransaction) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tokenTransactions).values(data);
  // Update company balance
  if (data.source === "external") {
    const delta = data.type === "credit" ? data.amount : -data.amount;
    await db.update(companies).set({ externalTokensBalance: sql`externalTokensBalance + ${delta}` }).where(eq(companies.id, data.companyId));
  } else {
    const delta = data.type === "credit" ? data.amount : -data.amount;
    await db.update(companies).set({ tokensBalance: sql`tokensBalance + ${delta}` }).where(eq(companies.id, data.companyId));
  }
}

export async function getTokenTransactionsByCompany(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tokenTransactions).where(eq(tokenTransactions.companyId, companyId)).orderBy(desc(tokenTransactions.createdAt));
}

export async function getAllTokenTransactions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tokenTransactions).orderBy(desc(tokenTransactions.createdAt));
}

// ─── User Recent Activity ────────────────────────────────────────────

export async function getUserRecentActivity(userId: number, companyId?: number) {
  const db = await getDb();
  if (!db) return [];

  const activity: { type: string; description: string; date: Date }[] = [];

  // Token transactions from the company
  if (companyId) {
    const txns = await db.select().from(tokenTransactions)
      .where(eq(tokenTransactions.companyId, companyId))
      .orderBy(desc(tokenTransactions.createdAt))
      .limit(10);
    for (const tx of txns) {
      activity.push({
        type: tx.type === "credit" ? "token_credit" : "token_debit",
        description: tx.description || (tx.type === "credit" ? "Tokens creditados" : "Tokens debitados"),
        date: tx.createdAt,
      });
    }
  }

  // Invitations sent by the company
  if (companyId) {
    const invites = await db.select().from(invitations)
      .where(eq(invitations.companyId, companyId))
      .orderBy(desc(invitations.createdAt))
      .limit(5);
    for (const inv of invites) {
      activity.push({
        type: "invitation",
        description: `Convite enviado para ${inv.email}`,
        date: inv.createdAt,
      });
    }
  }

  // Sort by date descending and limit to 15
  activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return activity.slice(0, 15);
}
