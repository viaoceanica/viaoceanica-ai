import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: {
      ...actual.default,
      getAllCompanies: vi.fn().mockResolvedValue([
        { id: 1, name: "Empresa A", sector: "tech", email: "a@test.com" },
        { id: 2, name: "Empresa B", sector: "food", email: "b@test.com" },
      ]),
    },
  };
});

// Mock bcrypt
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));

// Mock scaffold
vi.mock("./scaffold", () => ({
  generateScaffoldZip: vi.fn(),
}));

import { appRouter } from "./routers";

const adminCtx = { user: { id: 1, role: "admin" as const, name: "Admin" } };
const userCtx = { user: { id: 2, role: "user" as const, name: "User" } };

describe("AI Usage Analytics Procedures", () => {
  const adminCaller = appRouter.createCaller(adminCtx as any);
  const userCaller = appRouter.createCaller(userCtx as any);

  describe("admin.aiUsage", () => {
    it("returns current month summary with tenant data", async () => {
      const result = await adminCaller.admin.aiUsage();
      expect(result).toHaveProperty("period", "current_month");
      expect(result).toHaveProperty("period_start");
      expect(result.tenants).toBeInstanceOf(Array);
      expect(result.tenants.length).toBeGreaterThanOrEqual(2);
      // Check that the mocked companies are included
      const tenantIds = result.tenants.map((t: any) => t.tenant_id);
      expect(tenantIds).toContain(1);
      expect(tenantIds).toContain(2);
      expect(result.tenants[0]).toHaveProperty("total_requests");
      expect(result.tenants[0]).toHaveProperty("total_tokens");
      expect(result.tenants[0]).toHaveProperty("total_cost_usd");
    });

    it("period_start is first day of current month", async () => {
      const result = await adminCaller.admin.aiUsage();
      const now = new Date();
      const expected = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      expect(result.period_start).toBe(expected);
    });

    it("rejects non-admin users", async () => {
      await expect(userCaller.admin.aiUsage()).rejects.toThrow();
    });
  });

  describe("admin.aiUsageDaily", () => {
    it("returns daily breakdown structure", async () => {
      const result = await adminCaller.admin.aiUsageDaily();
      expect(result).toHaveProperty("period_start");
      expect(result).toHaveProperty("days");
      expect(result.days).toBeInstanceOf(Array);
    });

    it("period_start matches current month", async () => {
      const result = await adminCaller.admin.aiUsageDaily();
      const now = new Date();
      const expected = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      expect(result.period_start).toBe(expected);
    });

    it("rejects non-admin users", async () => {
      await expect(userCaller.admin.aiUsageDaily()).rejects.toThrow();
    });
  });

  describe("admin.aiUsageModules", () => {
    it("returns module breakdown structure", async () => {
      const result = await adminCaller.admin.aiUsageModules();
      expect(result).toHaveProperty("period_start");
      expect(result).toHaveProperty("modules");
      expect(result.modules).toBeInstanceOf(Array);
    });

    it("rejects non-admin users", async () => {
      await expect(userCaller.admin.aiUsageModules()).rejects.toThrow();
    });
  });

  describe("admin.aiUsageRecent", () => {
    it("returns recent events structure", async () => {
      const result = await adminCaller.admin.aiUsageRecent();
      expect(result).toHaveProperty("events");
      expect(result.events).toBeInstanceOf(Array);
    });

    it("rejects non-admin users", async () => {
      await expect(userCaller.admin.aiUsageRecent()).rejects.toThrow();
    });
  });
});
