import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

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
        const transactions = await db.getTokenTransactionsByCompany(input.companyId);
        const plan = company?.planId ? await db.getPlanById(company.planId) : null;
        return { company, members: members.map(m => ({ ...m, passwordHash: undefined })), modules: companyMods, transactions, plan };
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
    assignPlan: adminProcedure
      .input(z.object({ companyId: z.number(), planId: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateCompany(input.companyId, { planId: input.planId });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
