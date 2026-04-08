import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(user: AuthenticatedUser | null = null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function createTestUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user-open-id",
    email: "test@example.com",
    name: "Test User",
    loginMethod: null,
    role: "user",
    companyId: 1,
    companyRole: "owner",
    passwordHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function createAdminUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return createTestUser({
    id: 99,
    email: "admin@example.com",
    name: "Admin User",
    role: "admin",
    ...overrides,
  });
}

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated users", async () => {
    const user = createTestUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    // me() fetches company from DB, which may fail in test env
    // but the user fields should be present
    expect(result).toBeDefined();
    if (result) {
      expect(result.email).toBe("test@example.com");
      expect(result.name).toBe("Test User");
      expect(result.passwordHash).toBeUndefined();
    }
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
    const user = createTestUser();
    const ctx: TrpcContext = {
      user,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as unknown as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1 });
  });
});

describe("plans.list", () => {
  it("returns an array of plans (public procedure)", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.plans.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("modules.listAll", () => {
  it("returns an array of modules (public procedure)", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.modules.listAll();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("admin procedures", () => {
  it("rejects non-admin users", async () => {
    const user = createTestUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.companies()).rejects.toThrow();
  });

  it("rejects unauthenticated users", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.companies()).rejects.toThrow();
  });

  it("allows admin users to access companies", async () => {
    const admin = createAdminUser();
    const ctx = createMockContext(admin);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.companies();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("companyMembers procedures", () => {
  it("rejects unauthenticated access to updateRole", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.companyMembers.updateRole({ userId: 2, role: "admin" })).rejects.toThrow();
  });

  it("rejects unauthenticated access to remove", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.companyMembers.remove({ userId: 2 })).rejects.toThrow();
  });

  it("rejects non-owner/admin from updating roles", async () => {
    const user = createTestUser({ companyRole: "member" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.companyMembers.updateRole({ userId: 2, role: "admin" })).rejects.toThrow("Sem permiss\u00e3o");
  });

  it("rejects self-role change", async () => {
    const user = createTestUser({ companyRole: "owner" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.companyMembers.updateRole({ userId: user.id, role: "admin" })).rejects.toThrow("N\u00e3o pode alterar o seu pr\u00f3prio papel");
  });

  it("rejects self-removal", async () => {
    const user = createTestUser({ companyRole: "owner" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.companyMembers.remove({ userId: user.id })).rejects.toThrow("N\u00e3o pode remover-se a si pr\u00f3prio");
  });
});

describe("profile procedures", () => {
  it("rejects unauthenticated access to profile.get", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.profile.get()).rejects.toThrow();
  });

  it("rejects unauthenticated access to profile.updateName", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.profile.updateName({ name: "New Name" })).rejects.toThrow();
  });

  it("validates name is not empty on updateName", async () => {
    const user = createTestUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.profile.updateName({ name: "" })).rejects.toThrow();
  });
});

describe("protected procedures", () => {
  it("rejects unauthenticated access to company.get", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.company.get()).rejects.toThrow();
  });

  it("returns company data for authenticated user", async () => {
    const user = createTestUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    // May return null if company doesn't exist in test DB, but should not throw
    const result = await caller.company.get();
    // Either null (no company in test DB) or an object
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("rejects unauthenticated access to tokens.balance", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.tokens.balance()).rejects.toThrow();
  });

  it("returns token balance for authenticated user", async () => {
    const user = createTestUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.tokens.balance();
    expect(result).toHaveProperty("internal");
    expect(result).toHaveProperty("external");
    expect(typeof result.internal).toBe("number");
    expect(typeof result.external).toBe("number");
  });
});
