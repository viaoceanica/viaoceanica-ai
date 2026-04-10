import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db module
vi.mock("./db", () => {
  const mockModules = [
    { id: 1, slug: "contabilidade", name: "Contabilidade", description: "Módulo de contabilidade", icon: "Receipt", mountType: "iframe", backendUrl: "http://mod-contabilidade:8000", frontendUrl: "http://mod-contabilidade-fe:3000", status: "active", isActive: true, createdAt: new Date() },
    { id: 2, slug: "restauracao", name: "Restauração", description: "Módulo de restauração", icon: "UtensilsCrossed", mountType: "iframe", backendUrl: "http://mod-restauracao:3000", frontendUrl: null, status: "active", isActive: true, createdAt: new Date() },
  ];

  const mockCompanies = [
    { id: 1, name: "Via Oceânica", sector: "Tecnologia", email: "info@viaoceanica.pt", planId: 1, tokensBalance: 5000, externalTokensBalance: 1000, createdAt: new Date(), updatedAt: new Date() },
    { id: 2, name: "Demo Corp", sector: "Comércio", email: "demo@demo.pt", planId: 2, tokensBalance: 200, externalTokensBalance: 0, createdAt: new Date(), updatedAt: new Date() },
  ];

  const mockPlans = [
    { id: 1, name: "Enterprise", price: 9900, tokensPerMonth: 10000, maxMembers: 50, isActive: true },
    { id: 2, name: "Starter", price: 0, tokensPerMonth: 100, maxMembers: 3, isActive: true },
  ];

  let nextModuleId = 3;

  return {
    getAllModules: vi.fn(() => Promise.resolve([...mockModules])),
    createModule: vi.fn((data: any) => {
      const newMod = { id: nextModuleId++, ...data, isActive: true, createdAt: new Date() };
      mockModules.push(newMod);
      return Promise.resolve(newMod);
    }),
    getModuleById: vi.fn((id: number) => Promise.resolve(mockModules.find(m => m.id === id))),
    updateModule: vi.fn((id: number, data: any) => {
      const mod = mockModules.find(m => m.id === id);
      if (mod) Object.assign(mod, data);
      return Promise.resolve();
    }),
    deleteModule: vi.fn(() => Promise.resolve()),
    getAllCompanies: vi.fn(() => Promise.resolve([...mockCompanies])),
    getCompanyById: vi.fn((id: number) => Promise.resolve(mockCompanies.find(c => c.id === id))),
    updateCompany: vi.fn(() => Promise.resolve()),
    deleteCompany: vi.fn(() => Promise.resolve()),
    getAllPlans: vi.fn(() => Promise.resolve([...mockPlans])),
    getPlanById: vi.fn((id: number) => Promise.resolve(mockPlans.find(p => p.id === id))),
    getTenantBillingSummary: vi.fn(() => Promise.resolve([
      { companyId: 1, companyName: "Via Oceânica", sector: "Tecnologia", planName: "Enterprise", planPrice: 99, tokensBalance: 5000, externalTokensBalance: 1000, memberCount: 5, activeModules: 2 },
      { companyId: 2, companyName: "Demo Corp", sector: "Comércio", planName: "Starter", planPrice: 0, tokensBalance: 200, externalTokensBalance: 0, memberCount: 1, activeModules: 0 },
    ])),
    getAdminByUsername: vi.fn((username: string) => {
      if (username === "admin") {
        // bcrypt hash of "Password321!"
        return Promise.resolve({ id: 1, username: "admin", passwordHash: "$2a$12$dummyhash" });
      }
      return Promise.resolve(null);
    }),
    updateAdminPassword: vi.fn(() => Promise.resolve()),
    getCompanyModules: vi.fn(() => Promise.resolve([])),
    getTokenTransactionsByCompany: vi.fn(() => Promise.resolve([])),
    getAllTokenTransactions: vi.fn(() => Promise.resolve([])),
    getAllUsers: vi.fn(() => Promise.resolve([])),
    setCompanyModule: vi.fn(() => Promise.resolve()),
    addTokenTransaction: vi.fn(() => Promise.resolve()),
  };
});

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 999,
      openId: "admin-system",
      email: "admin@viaoceanica.system",
      name: "Administrador",
      loginMethod: "local",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createNonAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "regular-user",
      email: "user@test.com",
      name: "Regular User",
      loginMethod: "local",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("admin.allModules", () => {
  it("returns all modules for admin user", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.allModules();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toHaveProperty("slug");
    expect(result[0]).toHaveProperty("name");
  });

  it("rejects non-admin users", async () => {
    const ctx = createNonAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.allModules()).rejects.toThrow();
  });
});

describe("admin.createModule", () => {
  it("creates a new module with all fields", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.createModule({
      slug: "test-module",
      name: "Test Module",
      description: "A test module",
      icon: "Puzzle",
      mountType: "iframe",
      backendUrl: "http://test:8000",
      frontendUrl: "http://test-fe:3000",
      status: "active",
    });
    expect(result).toHaveProperty("id");
    expect(result?.slug).toBe("test-module");
    expect(result?.name).toBe("Test Module");
  });

  it("requires slug and name", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.createModule({ slug: "", name: "Test" })).rejects.toThrow();
    await expect(caller.admin.createModule({ slug: "test", name: "" })).rejects.toThrow();
  });
});

describe("admin.updateModule", () => {
  it("updates module fields", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.updateModule({
      id: 1,
      name: "Updated Name",
      mountType: "api_only",
    });
    expect(result).toBeDefined();
  });
});

describe("admin.deleteModule", () => {
  it("deletes a module", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.deleteModule({ id: 1 });
    expect(result).toEqual({ success: true });
  });
});

describe("admin.tenantBilling", () => {
  it("returns billing summary for all tenants", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.tenantBilling();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]).toHaveProperty("companyId");
    expect(result[0]).toHaveProperty("companyName");
    expect(result[0]).toHaveProperty("planName");
    expect(result[0]).toHaveProperty("planPrice");
    expect(result[0]).toHaveProperty("tokensBalance");
    expect(result[0]).toHaveProperty("memberCount");
    expect(result[0]).toHaveProperty("activeModules");
  });

  it("rejects non-admin users", async () => {
    const ctx = createNonAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.tenantBilling()).rejects.toThrow();
  });
});

describe("admin.plans", () => {
  it("returns all plans", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.plans();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("price");
  });
});

describe("admin.companies", () => {
  it("returns all companies for admin", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.companies();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
  });
});

describe("admin access control", () => {
  it("blocks unauthenticated users from admin routes", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.allModules()).rejects.toThrow();
    await expect(caller.admin.tenantBilling()).rejects.toThrow();
    await expect(caller.admin.companies()).rejects.toThrow();
  });
});
