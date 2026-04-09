/**
 * Platform Core — Email Service (Nodemailer + SMTP)
 *
 * Sends transactional emails for password recovery, invitations, etc.
 */

import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "mail.viaoceanica.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const APP_NAME = "Via Oceânica AI";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return _transporter;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${APP_NAME}" <${SMTP_FROM}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ""),
    });
    console.log(`[Email] Sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error("[Email] Send failed:", error);
    return false;
  }
}

export async function sendPasswordResetEmail(options: {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<boolean> {
  const { to, name, resetUrl, expiresInMinutes } = options;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f7f8fa; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 12px; padding: 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo span { font-size: 20px; font-weight: 700; color: #0f172a; }
    .logo .accent { color: #0d9e7a; }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #0f172a; text-align: center; }
    .subtitle { color: #64748b; font-size: 14px; text-align: center; margin: 0 0 28px; line-height: 1.5; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #0d9e7a; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .note { color: #64748b; font-size: 13px; text-align: center; line-height: 1.5; margin-top: 24px; }
    .url-fallback { word-break: break-all; color: #0d9e7a; font-size: 12px; text-align: center; margin-top: 16px; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <span><span class="accent">&gt;O</span> VIA OCEÂNICA</span>
      </div>
      <h1>Recuperar password</h1>
      <p class="subtitle">
        Olá ${name},<br>
        Recebemos um pedido para redefinir a password da sua conta.
      </p>
      <div class="btn-wrap">
        <a href="${resetUrl}" class="btn">Redefinir password</a>
      </div>
      <p class="note">
        Este link expira em <strong>${expiresInMinutes} minutos</strong>.<br>
        Se não solicitou esta alteração, pode ignorar este email.
      </p>
      <p class="url-fallback">
        Se o botão não funcionar, copie e cole este link no navegador:<br>
        ${resetUrl}
      </p>
    </div>
    <p class="footer">
      © ${new Date().getFullYear()} Via Oceânica AI Platform<br>
      Este email foi enviado automaticamente. Não responda a esta mensagem.
    </p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({
    to,
    subject: `${APP_NAME} — Recuperar password`,
    html,
  });
}
