import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock LLM ──────────────────────────────────────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async ({ messages }: any) => {
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsg = messages.find((m: any) => m.role === "user")?.content || "";
    let reply = "Resposta genérica do assistente.";
    if (systemMsg.includes("contabilidade")) {
      reply = `Resposta de contabilidade sobre: ${userMsg}`;
    }
    return {
      choices: [{ message: { content: reply } }],
    };
  }),
}));

// ─── Mock DB ──────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getCompanyById: vi.fn((id: number) => {
    if (id === 10) return { id: 10, name: "Test Company", planId: 1, tokensBalance: 500, externalTokensBalance: 0 };
    return null;
  }),
  getPlanById: vi.fn((id: number) => {
    if (id === 1) return { id: 1, name: "Professional", tokensPerMonth: 10000, maxMembers: 10, price: 4900, isActive: true };
    return null;
  }),
  // Stubs for other db functions referenced by the router
  getAllPlans: vi.fn(() => []),
  getPlansWithCompanyCounts: vi.fn(() => []),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  getAllModules: vi.fn(() => []),
  getModuleById: vi.fn(() => null),
  createModule: vi.fn(),
  updateModule: vi.fn(),
  deleteModule: vi.fn(),
  getAllCompanies: vi.fn(() => []),
  getCompanyMembers: vi.fn(() => []),
  getCompanyModules: vi.fn(() => []),
  getTokenTransactionsByCompany: vi.fn(() => []),
  addTokenTransaction: vi.fn(),
  getAllUsers: vi.fn(() => []),
  getAllTokenTransactions: vi.fn(() => []),
  getTenantBillingSummary: vi.fn(() => []),
  getAdminByUsername: vi.fn(() => null),
  updateAdminPassword: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  deleteCompany: vi.fn(),
  setCompanyModule: vi.fn(),
  getUserById: vi.fn(() => null),
  updateUser: vi.fn(),
  getTeamsByCompany: vi.fn(() => []),
  getTeamMembers: vi.fn(() => []),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  deleteTeam: vi.fn(),
  createTeam: vi.fn(),
  getPendingInvitationsByCompany: vi.fn(() => []),
  createInvitation: vi.fn(),
  getActiveModulesForUser: vi.fn(() => []),
  getModulePermissions: vi.fn(() => []),
  setModulePermissions: vi.fn(),
  getCompanyModulesWithDetails: vi.fn(() => []),
  getUserRecentActivity: vi.fn(() => []),
}));

// ─── Mock scaffold ──────────────────────────────────────────────────────

vi.mock("./scaffold", () => ({
  generateScaffoldZip: vi.fn(async () => Buffer.from("mock-zip")),
}));

// ─── Helpers ──────────────────────────────────────────────────────────

function createAuthContext(companyId: number | null = 10): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "user@test.com",
      name: "Test User",
      loginMethod: "password",
      role: "user",
      companyId: companyId ?? undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const caller = (ctx: TrpcContext) => appRouter.createCaller(ctx);

// ─── Tests: AI Agent Chat ──────────────────────────────────────────────

describe("ai.chat", () => {
  it("should route to contabilidade agent and return reply", async () => {
    const ctx = createAuthContext();
    const result = await caller(ctx).ai.chat({
      message: "Qual a taxa de IVA?",
      moduleKey: "contabilidade",
    });
    expect(result.reply).toContain("contabilidade");
    expect(result.reply).toContain("Qual a taxa de IVA?");
    expect(result.agent).toBe("contabilidade");
    expect(result.module).toBe("contabilidade");
  });

  it("should default to contabilidade when moduleKey is unknown", async () => {
    const ctx = createAuthContext();
    const result = await caller(ctx).ai.chat({
      message: "Olá",
      moduleKey: "unknown-module",
    });
    // Falls back to contabilidade prompt (the only active module)
    expect(result.reply).toContain("contabilidade");
    expect(result.agent).toBe("unknown-module");
  });

  it("should default to contabilidade when no moduleKey provided", async () => {
    const ctx = createAuthContext();
    const result = await caller(ctx).ai.chat({
      message: "Olá",
    });
    expect(result.agent).toBe("contabilidade");
  });

  it("should include conversation history in LLM call", async () => {
    const { invokeLLM } = await import("./_core/llm");
    const ctx = createAuthContext();
    await caller(ctx).ai.chat({
      message: "E o IRS?",
      moduleKey: "contabilidade",
      history: [
        { role: "user", content: "Fala-me do IVA" },
        { role: "assistant", content: "O IVA em Portugal é 23%." },
      ],
    });
    // Verify invokeLLM was called with history messages
    expect(invokeLLM).toHaveBeenCalled();
    const lastCall = (invokeLLM as any).mock.calls.at(-1)[0];
    expect(lastCall.messages.length).toBe(4); // system + 2 history + user
    expect(lastCall.messages[1].content).toBe("Fala-me do IVA");
    expect(lastCall.messages[2].content).toBe("O IVA em Portugal é 23%.");
    expect(lastCall.messages[3].content).toBe("E o IRS?");
  });

  it("should truncate history to last 10 messages", async () => {
    const { invokeLLM } = await import("./_core/llm");
    const ctx = createAuthContext();
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));
    await caller(ctx).ai.chat({
      message: "Último",
      moduleKey: "contabilidade",
      history: longHistory,
    });
    const lastCall = (invokeLLM as any).mock.calls.at(-1)[0];
    // system + 10 history (truncated) + user = 12
    expect(lastCall.messages.length).toBe(12);
  });

  it("should reject unauthenticated users", async () => {
    const ctx = createUnauthContext();
    await expect(caller(ctx).ai.chat({ message: "Olá" })).rejects.toThrow();
  });
});

// ─── Tests: AI Quota ──────────────────────────────────────────────────

describe("ai.quota", () => {
  it("should return quota for user with company and plan", async () => {
    const ctx = createAuthContext(10);
    const result = await caller(ctx).ai.quota();
    expect(result.limit).toBe(10000);
    expect(result.unlimited).toBe(false);
  });

  it("should return unlimited when user has no company", async () => {
    const ctx = createAuthContext(null);
    const result = await caller(ctx).ai.quota();
    expect(result.unlimited).toBe(true);
    expect(result.limit).toBe(0);
  });

  it("should reject unauthenticated users", async () => {
    const ctx = createUnauthContext();
    await expect(caller(ctx).ai.quota()).rejects.toThrow();
  });
});
