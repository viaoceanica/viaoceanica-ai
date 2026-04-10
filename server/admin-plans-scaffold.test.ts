import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB ──────────────────────────────────────────────────────────

const mockPlans = [
  { id: 1, name: "Starter", description: "Basic plan", tokensPerMonth: 1000, maxMembers: 3, price: 0, isActive: true, modulesAccess: null, createdAt: new Date(), updatedAt: new Date() },
  { id: 2, name: "Professional", description: "Pro plan", tokensPerMonth: 10000, maxMembers: 10, price: 4900, isActive: true, modulesAccess: null, createdAt: new Date(), updatedAt: new Date() },
];

let nextPlanId = 3;
const createdPlans: any[] = [];

vi.mock("./db", () => ({
  getAllPlans: vi.fn(() => [...mockPlans, ...createdPlans]),
  getPlansWithCompanyCounts: vi.fn(() =>
    [...mockPlans, ...createdPlans].map(p => ({ ...p, companyCount: 0 }))
  ),
  getPlanById: vi.fn((id: number) => {
    const all = [...mockPlans, ...createdPlans];
    return all.find(p => p.id === id) || null;
  }),
  createPlan: vi.fn((data: any) => {
    const plan = { id: nextPlanId++, ...data, createdAt: new Date(), updatedAt: new Date() };
    createdPlans.push(plan);
    return plan;
  }),
  updatePlan: vi.fn(async (id: number, data: any) => {
    const all = [...mockPlans, ...createdPlans];
    const plan = all.find(p => p.id === id);
    if (plan) Object.assign(plan, data);
  }),
  deletePlan: vi.fn(async (id: number) => {
    const idx = createdPlans.findIndex(p => p.id === id);
    if (idx >= 0) createdPlans.splice(idx, 1);
  }),
  // Stubs for other db functions used by the router
  getAllModules: vi.fn(() => []),
  getModuleById: vi.fn(() => null),
  createModule: vi.fn((data: any) => ({ id: 1, ...data })),
  updateModule: vi.fn(),
  deleteModule: vi.fn(),
  getAllCompanies: vi.fn(() => []),
  getCompanyById: vi.fn(() => null),
  getCompanyMembers: vi.fn(() => []),
  getCompanyModules: vi.fn(() => []),
  getTokenTransactionsByCompany: vi.fn(() => []),
  addTokenTransaction: vi.fn(),
  getAllUsers: vi.fn(() => []),
  getAllTokenTransactions: vi.fn(() => []),
  getTenantBillingSummary: vi.fn(() => []),
  getAdminByUsername: vi.fn(() => null),
  updateAdminPassword: vi.fn(),
  createCompany: vi.fn((data: any) => ({ id: 1, ...data })),
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

// ─── Helper: Admin Context ──────────────────────────────────────────

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "geral@viaoceanica.com",
      name: "Admin",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "regular-user",
      email: "user@test.com",
      name: "Regular User",
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("admin.plans CRUD", () => {
  beforeEach(() => {
    createdPlans.length = 0;
    nextPlanId = 3;
  });

  it("lists all plans (admin only)", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const plans = await caller.admin.plans();
    expect(plans).toHaveLength(2);
    expect(plans[0].name).toBe("Starter");
    expect(plans[1].name).toBe("Professional");
  });

  it("lists plans with company counts", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const plans = await caller.admin.plansWithCounts();
    expect(plans).toHaveLength(2);
    expect(plans[0]).toHaveProperty("companyCount");
  });

  it("creates a new plan", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const newPlan = await caller.admin.createPlan({
      name: "Enterprise",
      description: "Enterprise plan",
      tokensPerMonth: 100000,
      maxMembers: 50,
      price: 14900,
    });
    expect(newPlan.id).toBe(3);
    expect(newPlan.name).toBe("Enterprise");
    expect(newPlan.tokensPerMonth).toBe(100000);
  });

  it("creates a plan with modulesAccess", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const newPlan = await caller.admin.createPlan({
      name: "Custom",
      tokensPerMonth: 5000,
      maxMembers: 5,
      price: 2900,
      modulesAccess: '["contabilidade","restauracao"]',
    });
    expect(newPlan.name).toBe("Custom");
    expect(newPlan.modulesAccess).toBe('["contabilidade","restauracao"]');
  });

  it("updates an existing plan", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const updated = await caller.admin.updatePlan({
      id: 1,
      name: "Starter Plus",
      tokensPerMonth: 2000,
      isActive: false,
    });
    // updatePlan returns getPlanById result
    expect(updated).toBeDefined();
  });

  it("deletes a plan", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    // First create one to delete
    await caller.admin.createPlan({ name: "ToDelete", tokensPerMonth: 100, maxMembers: 1, price: 0 });
    const result = await caller.admin.deletePlan({ id: 3 });
    expect(result).toEqual({ success: true });
  });

  it("rejects non-admin user from listing plans", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.admin.plans()).rejects.toThrow();
  });

  it("rejects non-admin user from creating plans", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(
      caller.admin.createPlan({ name: "Hack", tokensPerMonth: 999, maxMembers: 999, price: 0 })
    ).rejects.toThrow();
  });

  it("rejects non-admin user from deleting plans", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.admin.deletePlan({ id: 1 })).rejects.toThrow();
  });
});

describe("admin.generateScaffold", () => {
  it("generates a scaffold ZIP (base64) for a Python module", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.admin.generateScaffold({
      slug: "test-module",
      name: "Test Module",
      description: "A test module",
      icon: "Puzzle",
      mountType: "iframe",
      backendLanguage: "python",
      databaseMode: "shared",
      capabilities: ["ai", "storage"],
      port: 4099,
    });
    expect(result).toHaveProperty("base64");
    expect(result).toHaveProperty("filename");
    expect(result.filename).toContain("test-module");
    // Verify base64 is valid
    const buffer = Buffer.from(result.base64, "base64");
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("generates a scaffold ZIP for a Node.js module", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.admin.generateScaffold({
      slug: "node-mod",
      name: "Node Module",
      mountType: "api_only",
      backendLanguage: "nodejs",
      databaseMode: "separate",
      capabilities: [],
      port: 4050,
    });
    expect(result.base64).toBeTruthy();
    expect(result.filename).toContain("node-mod");
  });

  it("generates a scaffold ZIP for an internal mount module", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.admin.generateScaffold({
      slug: "internal-mod",
      name: "Internal Module",
      mountType: "internal",
      backendLanguage: "python",
      databaseMode: "shared",
      capabilities: ["notifications"],
      port: 4060,
    });
    expect(result.base64).toBeTruthy();
    // Internal mount should not include frontend files (smaller ZIP)
    const buffer = Buffer.from(result.base64, "base64");
    expect(buffer.length).toBeGreaterThan(50);
  });

  it("rejects non-admin user from generating scaffold", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(
      caller.admin.generateScaffold({
        slug: "hack",
        name: "Hack Module",
        mountType: "iframe",
        backendLanguage: "python",
        databaseMode: "shared",
        capabilities: [],
        port: 9999,
      })
    ).rejects.toThrow();
  });

  it("rejects scaffold with empty slug", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(
      caller.admin.generateScaffold({
        slug: "",
        name: "No Slug",
        mountType: "iframe",
        backendLanguage: "python",
        databaseMode: "shared",
        capabilities: [],
        port: 4099,
      })
    ).rejects.toThrow();
  });
});
