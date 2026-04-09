/**
 * Platform Core — Password Reset Routes
 *
 * POST /api/auth/forgot-password  → Generate reset token, send email
 * POST /api/auth/reset-password   → Validate token, update password
 * GET  /api/auth/verify-reset-token → Check if token is valid (for frontend)
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { getDb } from "../db.js";
import { users, passwordResetTokens } from "../../drizzle/schema.js";
import { eq, and, gt } from "drizzle-orm";
import { sendPasswordResetEmail } from "../email/service.js";

const router = Router();

const RESET_TOKEN_EXPIRY_MINUTES = 30;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://77.42.95.216:8200";

// ─── POST /forgot-password ──────────────────────────────────────────

router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email, origin } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_EMAIL", message: "Email é obrigatório" },
      });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE", message: "Base de dados indisponível" },
      });
    }

    // Find user by email
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);

    // Always return success to prevent email enumeration
    if (result.length === 0) {
      console.log(`[Auth] Password reset requested for non-existent email: ${email}`);
      return res.json({ success: true, message: "Se o email estiver registado, receberá instruções." });
    }

    const user = result[0];

    // Invalidate any existing tokens for this user
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(and(eq(passwordResetTokens.userId, user.id), eq(passwordResetTokens.used, false)));

    // Generate new token
    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token,
      expiresAt,
      used: false,
    });

    // Build reset URL using origin from frontend (or fallback)
    const baseUrl = origin || APP_BASE_URL;
    const resetUrl = `${baseUrl}/reset-password/${token}`;

    // Send email
    const sent = await sendPasswordResetEmail({
      to: user.email,
      name: user.name || "Utilizador",
      resetUrl,
      expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES,
    });

    if (!sent) {
      console.error(`[Auth] Failed to send password reset email to ${user.email}`);
      return res.status(500).json({
        success: false,
        error: { code: "EMAIL_FAILED", message: "Erro ao enviar email. Tente novamente mais tarde." },
      });
    }

    console.log(`[Auth] Password reset email sent to ${user.email} (token expires at ${expiresAt.toISOString()})`);
    return res.json({ success: true, message: "Se o email estiver registado, receberá instruções." });
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
  }
});

// ─── GET /verify-reset-token ────────────────────────────────────────

router.get("/verify-reset-token", async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_TOKEN", message: "Token é obrigatório" },
      });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE" },
      });
    }

    const result = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.used, false),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (result.length === 0) {
      return res.json({ success: true, data: { valid: false } });
    }

    return res.json({ success: true, data: { valid: true } });
  } catch (error) {
    console.error("[Auth] Verify reset token error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR" },
    });
  }
});

// ─── POST /reset-password ───────────────────────────────────────────

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_FIELDS", message: "Token e nova password são obrigatórios" },
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: "WEAK_PASSWORD", message: "A password deve ter pelo menos 6 caracteres" },
      });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE" },
      });
    }

    // Find valid token
    const tokenResult = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          eq(passwordResetTokens.used, false),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (tokenResult.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Token inválido ou expirado. Solicite um novo link de recuperação.",
        },
      });
    }

    const resetToken = tokenResult[0];

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user password
    await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));

    // Mark token as used
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, resetToken.id));

    console.log(`[Auth] Password reset successful for user ID ${resetToken.userId}`);

    return res.json({ success: true, message: "Password atualizada com sucesso." });
  } catch (error) {
    console.error("[Auth] Reset password error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
  }
});

export { router as passwordResetRouter };
