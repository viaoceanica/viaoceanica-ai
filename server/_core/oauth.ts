import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

export function registerOAuthRoutes(app: Express) {
  // Register endpoint
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName, sector } = req.body;

      if (!email || !password || !name || !companyName) {
        res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos" });
        return;
      }

      // Check if email already exists
      const existing = await db.getUserByEmail(email);
      if (existing) {
        res.status(400).json({ error: "Este email já está registado" });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create company first
      const company = await db.createCompany({
        name: companyName,
        sector: sector || null,
        email,
      });

      if (!company) {
        res.status(500).json({ error: "Erro ao criar empresa" });
        return;
      }

      // Assign default Starter plan
      const allPlans = await db.getAllPlans();
      const starterPlan = allPlans.find(p => p.name === "Starter");
      if (starterPlan) {
        await db.updateCompany(company.id, { planId: starterPlan.id });
      }

      // Create user as company owner
      const user = await db.createUser({
        email,
        name,
        passwordHash,
        companyId: company.id,
        companyRole: "owner",
      });

      if (!user) {
        res.status(500).json({ error: "Erro ao criar utilizador" });
        return;
      }

      // Create session
      const sessionToken = await sdk.createSessionToken(user.id, {
        email: user.email || "",
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Register failed", error);
      res.status(500).json({ error: "Erro no registo" });
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "Email e password são obrigatórios" });
        return;
      }

      const user = await db.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      // Update last signed in
      await db.updateUser(user.id, { lastSignedIn: new Date() });

      // Create session
      const sessionToken = await sdk.createSessionToken(user.id, {
        email: user.email || "",
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Erro no login" });
    }
  });
}
