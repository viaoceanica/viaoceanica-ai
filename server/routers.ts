import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { generateScaffoldZip, type ScaffoldConfig } from "./scaffold";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (!opts.ctx.user) return null;
      const user = opts.ctx.user;
      let company = null;
      if (user.companyId) {
        company = await db.getCompanyById(user.companyId);
      }
      return {
        ...user,
        passwordHash: undefined,
        company,
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(6) }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new Error("Utilizador não encontrado");
        const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
        if (!valid) throw new Error("Password atual incorreta");
        const newHash = await bcrypt.hash(input.newPassword, 12);
        await db.updateUser(ctx.user.id, { passwordHash: newHash });
        return { success: true };
      }),
  }),
  // ─── Profile ───────────────────────────────────────────────────────
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) throw new Error("Utilizador não encontrado");
      let company = null;
      let plan = null;
      let teams: { id: number; name: string }[] = [];
      if (user.companyId) {
        company = await db.getCompanyById(user.companyId);
        if (company?.planId) plan = await db.getPlanById(company.planId);
        const allTeams = await db.getTeamsByCompany(user.companyId);
        teams = allTeams.map(t => ({ id: t.id, name: t.name }));
      }
      const recentActivity = await db.getUserRecentActivity(ctx.user.id, user.companyId ?? undefined);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyRole: user.companyRole,
        createdAt: user.createdAt,
        lastSignedIn: user.lastSignedIn,
        company: company ? { id: company.id, name: company.name, sector: company.sector } : null,
        plan: plan ? { name: plan.name } : null,
        teams,
        recentActivity,
      };
    }),
    updateName: protectedProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUser(ctx.user.id, { name: input.name });
        return { success: true };
      }),
  }),

  // ─── Company ───────────────────────────────────────────────────────
  company: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return null;
      return db.getCompanyById(ctx.user.companyId);
    }),
    update: protectedProcedure
      .input(z.object({
        name: z.string().optional(),
        sector: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        logo: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        await db.updateCompany(ctx.user.companyId, input);
        return db.getCompanyById(ctx.user.companyId);
      }),
    members: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      const members = await db.getCompanyMembers(ctx.user.companyId);
      return members.map(m => ({ ...m, passwordHash: undefined }));
    }),
  }),

  // ─── Company Members Management ─────────────────────────────────
  companyMembers: router({
    updateRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["admin", "member"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        if (ctx.user.companyRole !== "owner" && ctx.user.companyRole !== "admin") throw new Error("Sem permissão");
        // Cannot change own role
        if (input.userId === ctx.user.id) throw new Error("Não pode alterar o seu próprio papel");
        // Cannot change owner's role
        const target = await db.getUserById(input.userId);
        if (!target || target.companyId !== ctx.user.companyId) throw new Error("Membro não encontrado");
        if (target.companyRole === "owner") throw new Error("Não pode alterar o papel do proprietário");
        await db.updateUser(input.userId, { companyRole: input.role });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        if (ctx.user.companyRole !== "owner" && ctx.user.companyRole !== "admin") throw new Error("Sem permissão");
        if (input.userId === ctx.user.id) throw new Error("Não pode remover-se a si próprio");
        const target = await db.getUserById(input.userId);
        if (!target || target.companyId !== ctx.user.companyId) throw new Error("Membro não encontrado");
        if (target.companyRole === "owner") throw new Error("Não pode remover o proprietário");
        await db.updateUser(input.userId, { companyId: null, companyRole: "member" });
        return { success: true };
      }),
  }),

  // ─── Teams ───────────────────────────────────────────────────────
  teams: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getTeamsByCompany(ctx.user.companyId);
    }),
    create: protectedProcedure
      .input(z.object({ name: z.string(), description: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        return db.createTeam({ companyId: ctx.user.companyId, name: input.name, description: input.description });
      }),
    delete: protectedProcedure
      .input(z.object({ teamId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteTeam(input.teamId);
        return { success: true };
      }),
    members: protectedProcedure
      .input(z.object({ teamId: z.number() }))
      .query(async ({ input }) => {
        return db.getTeamMembers(input.teamId);
      }),
    addMember: protectedProcedure
      .input(z.object({ teamId: z.number(), userId: z.number(), role: z.enum(["admin", "member"]).optional() }))
      .mutation(async ({ input }) => {
        await db.addTeamMember({ teamId: input.teamId, userId: input.userId, role: input.role || "member" });
        return { success: true };
      }),
    removeMember: protectedProcedure
      .input(z.object({ teamId: z.number(), userId: z.number() }))
      .mutation(async ({ input }) => {
        await db.removeTeamMember(input.teamId, input.userId);
        return { success: true };
      }),
  }),

  // ─── Invitations ─────────────────────────────────────────────────
  invitations: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getPendingInvitationsByCompany(ctx.user.companyId);
    }),
    create: protectedProcedure
      .input(z.object({ email: z.string().email(), teamId: z.number().optional(), role: z.enum(["admin", "member"]).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        const token = nanoid(64);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await db.createInvitation({
          companyId: ctx.user.companyId,
          teamId: input.teamId,
          email: input.email,
          role: input.role || "member",
          token,
          expiresAt,
        });
        return { success: true, token };
      }),
  }),

  // ─── Plans ───────────────────────────────────────────────────────
  plans: router({
    list: publicProcedure.query(async () => {
      return db.getAllPlans();
    }),
    current: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return null;
      const company = await db.getCompanyById(ctx.user.companyId);
      if (!company || !company.planId) return null;
      return db.getPlanById(company.planId);
    }),
  }),

  // ─── Modules ─────────────────────────────────────────────────────
  modules: router({
    listAll: publicProcedure.query(async () => {
      return db.getAllModules();
    }),
    companyModules: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getCompanyModules(ctx.user.companyId);
    }),
    toggle: protectedProcedure
      .input(z.object({ moduleId: z.number(), isEnabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        await db.setCompanyModule({ companyId: ctx.user.companyId, moduleId: input.moduleId, isEnabled: input.isEnabled });
        return { success: true };
      }),
    // Get active modules for the current user (for sidebar)
    activeForUser: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getActiveModulesForUser(ctx.user.id, ctx.user.companyId);
    }),
    // Get permissions for a specific company module
    getPermissions: protectedProcedure
      .input(z.object({ companyModuleId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.companyId) return [];
        return db.getModulePermissions(input.companyModuleId);
      }),
    // Set permissions for a company module (owner/admin only)
    setPermissions: protectedProcedure
      .input(z.object({
        companyModuleId: z.number(),
        permissions: z.array(z.object({ teamId: z.number().optional(), userId: z.number().optional() })),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.companyId) throw new Error("Sem empresa associada");
        if (ctx.user.companyRole !== "owner" && ctx.user.companyRole !== "admin") throw new Error("Sem permiss\u00e3o");
        await db.setModulePermissions(input.companyModuleId, input.permissions);
        return { success: true };
      }),
    // Get company modules with details (for module management page)
    companyModulesDetailed: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getCompanyModulesWithDetails(ctx.user.companyId);
    }),
  }),

  // ─── Tokens ──────────────────────────────────────────────────────
  tokens: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return { internal: 0, external: 0 };
      const company = await db.getCompanyById(ctx.user.companyId);
      if (!company) return { internal: 0, external: 0 };
      return { internal: company.tokensBalance, external: company.externalTokensBalance };
    }),
    transactions: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.companyId) return [];
      return db.getTokenTransactionsByCompany(ctx.user.companyId);
    }),
  }),

  // ─── Admin ───────────────────────────────────────────────────────
  admin: router({
    companies: adminProcedure.query(async () => {
      return db.getAllCompanies();
    }),
    companyDetails: adminProcedure
      .input(z.object({ companyId: z.number() }))
      .query(async ({ input }) => {
        const company = await db.getCompanyById(input.companyId);
        const members = await db.getCompanyMembers(input.companyId);
        const companyMods = await db.getCompanyModules(input.companyId);
        const allMods = await db.getAllModules();
        const transactions = await db.getTokenTransactionsByCompany(input.companyId);
        const plan = company?.planId ? await db.getPlanById(company.planId) : null;
        return {
          company,
          members: members.map(m => ({ ...m, passwordHash: undefined })),
          modules: companyMods.map(cm => {
            const mod = allMods.find(m => m.id === cm.moduleId);
            return { ...cm, slug: mod?.slug, name: mod?.name, icon: mod?.icon };
          }),
          transactions,
          plan,
        };
      }),
    grantTokens: adminProcedure
      .input(z.object({ companyId: z.number(), amount: z.number().positive(), source: z.enum(["internal", "external"]).default("internal"), description: z.string().optional() }))
      .mutation(async ({ input }) => {
        await db.addTokenTransaction({
          companyId: input.companyId,
          type: "credit",
          source: input.source === "external" ? "external" : "admin_grant",
          amount: input.amount,
          description: input.description || "Tokens atribuídos pelo administrador",
        });
        return { success: true };
      }),
    users: adminProcedure.query(async () => {
      const allUsers = await db.getAllUsers();
      return allUsers.map(u => ({ ...u, passwordHash: undefined }));
    }),
    allTransactions: adminProcedure.query(async () => {
      return db.getAllTokenTransactions();
    }),
    allModules: adminProcedure.query(async () => {
      return db.getAllModules();
    }),
    plans: adminProcedure.query(async () => {
      return db.getAllPlans();
    }),
    plansWithCounts: adminProcedure.query(async () => {
      return db.getPlansWithCompanyCounts();
    }),
    createPlan: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        tokensPerMonth: z.number().int().min(0).default(0),
        maxMembers: z.number().int().default(3),
        price: z.number().int().min(0).default(0),
        modulesAccess: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return db.createPlan(input);
      }),
    updatePlan: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        tokensPerMonth: z.number().int().min(0).optional(),
        maxMembers: z.number().int().optional(),
        price: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
        modulesAccess: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updatePlan(id, data as any);
        return db.getPlanById(id);
      }),
    deletePlan: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deletePlan(input.id);
        return { success: true };
      }),
    assignPlan: adminProcedure
      .input(z.object({ companyId: z.number(), planId: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateCompany(input.companyId, { planId: input.planId });
        return { success: true };
      }),

    // ─── Module CRUD ─────────────────────────────────────────────────
    createModule: adminProcedure
      .input(z.object({ slug: z.string().min(1), name: z.string().min(1), description: z.string().optional(), icon: z.string().optional(), mountType: z.string().optional(), backendUrl: z.string().optional(), frontendUrl: z.string().optional(), status: z.string().optional() }))
      .mutation(async ({ input }) => {
        return db.createModule(input);
      }),
    updateModule: adminProcedure
      .input(z.object({ id: z.number(), slug: z.string().optional(), name: z.string().optional(), description: z.string().optional(), icon: z.string().optional(), isActive: z.boolean().optional(), mountType: z.string().optional(), backendUrl: z.string().optional(), frontendUrl: z.string().optional(), status: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateModule(id, data as any);
        return db.getModuleById(id);
      }),
    deleteModule: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteModule(input.id);
        return { success: true };
      }),

    // ─── Billing Summary ─────────────────────────────────────────────
    tenantBilling: adminProcedure.query(async () => {
      return db.getTenantBillingSummary();
    }),

    // ─── Admin Password Change ───────────────────────────────────────
    changePassword: adminProcedure
      .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const admin = await db.getAdminByUsername("geral@viaoceanica.com");
        if (!admin) throw new Error("Admin não encontrado");
        const valid = await bcrypt.compare(input.currentPassword, admin.passwordHash);
        if (!valid) throw new Error("Password atual incorreta");
        const newHash = await bcrypt.hash(input.newPassword, 12);
        await db.updateAdminPassword(admin.id, newHash);
        return { success: true };
      }),

    // ─── Company Management ──────────────────────────────────────────
    createCompany: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        sector: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        nif: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return db.createCompany(input);
      }),
    updateCompany: adminProcedure
      .input(z.object({
        companyId: z.number(),
        name: z.string().optional(),
        sector: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        nif: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { companyId, ...data } = input;
        await db.updateCompany(companyId, data);
        return db.getCompanyById(companyId);
      }),
    deleteCompany: adminProcedure
      .input(z.object({ companyId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteCompany(input.companyId);
        return { success: true };
      }),

    // ─── Scaffold ZIP Export ────────────────────────────────────────
    generateScaffold: adminProcedure
      .input(z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().default(""),
        icon: z.string().default("Puzzle"),
        mountType: z.string().default("iframe"),
        backendLanguage: z.string().default("python"),
        databaseMode: z.string().default("shared"),
        capabilities: z.array(z.string()).default([]),
        port: z.number().int().default(4004),
      }))
      .mutation(async ({ input }) => {
        const cfg: ScaffoldConfig = {
          slug: input.slug,
          name: input.name,
          description: input.description,
          icon: input.icon,
          mountType: input.mountType,
          backendLanguage: input.backendLanguage,
          databaseMode: input.databaseMode,
          capabilities: input.capabilities,
          port: input.port,
        };
        const zipBuffer = await generateScaffoldZip(cfg);
        const base64 = zipBuffer.toString("base64");
        return { base64, filename: `module-${input.slug}-scaffold.zip` };
      }),

    // ─── Toggle module for company ───────────────────────────────────
    toggleCompanyModule: adminProcedure
      .input(z.object({ companyId: z.number(), moduleId: z.number(), isEnabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setCompanyModule({ companyId: input.companyId, moduleId: input.moduleId, isEnabled: input.isEnabled });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
