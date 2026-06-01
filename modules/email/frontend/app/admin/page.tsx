"use client";

import { useEffect, useMemo, useState } from "react";

type StatusPayload = {
  success: boolean;
  data?: {
    tenant_id?: string;
    user_id?: string;
    company_role?: string;
    platform_roles?: string[];
    can_manage_mailboxes?: boolean;
    message?: string;
  };
};

type AdminMailbox = {
  id: string;
  name: string;
  email_address: string;
  provider: string;
  status: string;
  sync_enabled: boolean;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_username?: string | null;
  security_mode: "ssl_tls" | "starttls" | "none";
  access_mode: "read_only" | "read_write";
  auth_method: "password";
  folder: string;
  validate_certificates: boolean;
  has_password: boolean;
  last_error?: string | null;
  last_connection_test_at?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
};

type MailboxFormState = {
  name: string;
  email_address: string;
  imap_host: string;
  imap_port: string;
  imap_username: string;
  imap_password: string;
  security_mode: "ssl_tls" | "starttls" | "none";
  access_mode: "read_only" | "read_write";
  folder: string;
  validate_certificates: boolean;
  sync_enabled: boolean;
};

const API_BASE = "/module/email/api-proxy";

const DEFAULT_FORM: MailboxFormState = {
  name: "",
  email_address: "",
  imap_host: "",
  imap_port: "993",
  imap_username: "",
  imap_password: "",
  security_mode: "ssl_tls",
  access_mode: "read_write",
  folder: "INBOX",
  validate_certificates: true,
  sync_enabled: true,
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function connectionLabel(securityMode: AdminMailbox["security_mode"]) {
  if (securityMode === "ssl_tls") return "SSL/TLS";
  if (securityMode === "starttls") return "STARTTLS";
  return "Sem encriptação";
}

function mailboxStatusLabel(status?: string | null) {
  switch ((status || "").toLowerCase()) {
    case "connected": return "Ligada";
    case "syncing": return "A sincronizar";
    case "configured": return "Configurada";
    case "paused": return "Em pausa";
    case "error": return "Erro";
    default: return status || "—";
  }
}

function statusColor(status: string) {
  if (status === "connected") return { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" };
  if (status === "syncing") return { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" };
  if (status === "configured") return { bg: "#fef9c3", color: "#854d0e", border: "#fde68a" };
  if (status === "error") return { bg: "#fee2e2", color: "#991b1b", border: "#fecaca" };
  if (status === "paused") return { bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" };
  return { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" };
}

export default function EmailAdminPage() {
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [platformRoles, setPlatformRoles] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [mailboxes, setMailboxes] = useState<AdminMailbox[]>([]);
  const [form, setForm] = useState<MailboxFormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formCollapsed, setFormCollapsed] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const queryTenantId = query.get("tenantId");
    const queryUserId = query.get("userId");
    const queryCompanyRole = query.get("companyRole");
    const queryPlatformRoles = query.get("platformRoles");

    if (queryTenantId) setTenantId(queryTenantId);
    if (queryUserId) setUserId(queryUserId);
    if (queryCompanyRole) setCompanyRole(queryCompanyRole);
    if (queryPlatformRoles) setPlatformRoles(queryPlatformRoles);

    const handleContextMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.type !== "viao-context") return;
      if (payload.tenantId) setTenantId(String(payload.tenantId));
      if (payload.userId) setUserId(String(payload.userId));
      if (payload.companyRole) setCompanyRole(String(payload.companyRole));
      if (payload.platformRoles) setPlatformRoles(String(payload.platformRoles));
    };

    window.addEventListener("message", handleContextMessage);

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "viao-context-request" }, "*");
      }
    } catch { /* ignore */ }

    const readyTimer = window.setTimeout(() => setContextReady(true), 400);
    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(readyTimer);
    };
  }, []);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
  }

  function buildHeaders(activeTenantId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "x-tenant-id": activeTenantId,
      "x-viao-tenant-id": activeTenantId,
    };
    if (userId) headers["x-viao-user-id"] = userId;
    if (companyRole) headers["x-viao-company-role"] = companyRole;
    if (platformRoles) headers["x-viao-platform-roles"] = platformRoles;
    return headers;
  }

  async function load(activeTenantId: string) {
    setLoading(true);
    setError("");
    try {
      const headers = buildHeaders(activeTenantId);
      const [statusRes, mailboxesRes] = await Promise.all([
        fetch(`${API_BASE}/api/status`, { headers }),
        fetch(`${API_BASE}/api/admin/mailboxes`, { headers }),
      ]);

      const statusJson = (await statusRes.json()) as StatusPayload;
      setStatus(statusJson);

      if (!statusRes.ok) {
        throw new Error(statusJson?.data?.message || "Falha ao carregar estado do módulo Email");
      }

      const mailboxesJson = await mailboxesRes.json();
      if (!mailboxesRes.ok) {
        throw new Error(mailboxesJson?.detail || "Falha ao carregar mailboxes administrativas");
      }

      setMailboxes(Array.isArray(mailboxesJson?.data) ? mailboxesJson.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar painel administrativo");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!contextReady) return;
    if (!tenantId) {
      setLoading(false);
      setError("Não foi possível obter o contexto da empresa.");
      return;
    }
    load(tenantId).catch(() => undefined);
  }, [contextReady, tenantId, userId, companyRole, platformRoles]);

  const canManage = useMemo(() => {
    if (status?.data?.can_manage_mailboxes) return true;
    const normalizedRole = (status?.data?.company_role || companyRole || "").toLowerCase();
    const roleSet = new Set(
      Array.isArray(status?.data?.platform_roles)
        ? status?.data?.platform_roles
        : platformRoles.split(",").map((item) => item.trim()).filter(Boolean)
    );
    return normalizedRole === "owner" || normalizedRole === "admin" || roleSet.has("admin");
  }, [status, companyRole, platformRoles]);

  async function submitForm() {
    if (!tenantId) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/admin/mailboxes${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders(tenantId) },
        body: JSON.stringify({ ...form, imap_port: Number(form.imap_port) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Falha ao guardar a caixa IMAP");
      setSuccess(editingId ? "Caixa atualizada com sucesso." : "Caixa criada com sucesso.");
      resetForm();
      await load(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar a caixa");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMailbox(mailboxId: string) {
    if (!tenantId) return;
    if (!confirm("Tem a certeza que deseja apagar esta caixa de email?")) return;
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/admin/mailboxes/${mailboxId}`, {
        method: "DELETE",
        headers: buildHeaders(tenantId),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Falha ao apagar a caixa");
      if (editingId === mailboxId) resetForm();
      setSuccess("Caixa removida com sucesso.");
      await load(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao apagar a caixa");
    }
  }

  async function testConnection(mailboxId: string) {
    if (!tenantId) return;
    setTestingId(mailboxId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/admin/mailboxes/${mailboxId}/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders(tenantId) },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Falha ao testar ligação IMAP");
      const message = payload?.data?.test_result?.message || "Ligação IMAP validada com sucesso.";
      setSuccess(message);
      await load(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao testar ligação IMAP");
    } finally {
      setTestingId(null);
    }
  }

  function startEdit(mailbox: AdminMailbox) {
    setEditingId(mailbox.id);
    setFormCollapsed(false);
    setForm({
      name: mailbox.name || "",
      email_address: mailbox.email_address || "",
      imap_host: mailbox.imap_host || "",
      imap_port: String(mailbox.imap_port || (mailbox.security_mode === "ssl_tls" ? 993 : 143)),
      imap_password: "",
      imap_username: mailbox.imap_username || "",
      security_mode: mailbox.security_mode || "ssl_tls",
      access_mode: mailbox.access_mode || "read_write",
      folder: mailbox.folder || "INBOX",
      validate_certificates: mailbox.validate_certificates !== false,
      sync_enabled: mailbox.sync_enabled !== false,
    });
    setSuccess("");
    setError("");
  }

  function updateSecurityMode(mode: MailboxFormState["security_mode"]) {
    setForm((current) => ({
      ...current,
      security_mode: mode,
      imap_port:
        current.imap_port === "993" || current.imap_port === "143"
          ? String(mode === "ssl_tls" ? 993 : 143)
          : current.imap_port,
    }));
  }

  // ─── Styles ───────────────────────────────────────────────────────
  const styles = {
    page: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "13px",
      lineHeight: "1.5",
      color: "#1e293b",
      background: "#f8fafc",
      minHeight: "100vh",
      padding: "24px",
      overflow: "auto",
    } as React.CSSProperties,
    container: {
      maxWidth: "1200px",
      margin: "0 auto",
    } as React.CSSProperties,
    header: {
      marginBottom: "24px",
    } as React.CSSProperties,
    breadcrumb: {
      fontSize: "11px",
      color: "#94a3b8",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
      fontWeight: 500,
      marginBottom: "8px",
    } as React.CSSProperties,
    title: {
      fontSize: "22px",
      fontWeight: 700,
      color: "#0f172a",
      margin: "0 0 4px",
    } as React.CSSProperties,
    subtitle: {
      fontSize: "13px",
      color: "#64748b",
      margin: 0,
    } as React.CSSProperties,
    statsRow: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: "12px",
      marginBottom: "20px",
    } as React.CSSProperties,
    statCard: {
      background: "#ffffff",
      borderRadius: "10px",
      padding: "16px",
      border: "1px solid #e2e8f0",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    } as React.CSSProperties,
    statLabel: {
      fontSize: "11px",
      color: "#94a3b8",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
      fontWeight: 600,
      marginBottom: "4px",
    } as React.CSSProperties,
    statValue: {
      fontSize: "24px",
      fontWeight: 700,
      color: "#0f172a",
    } as React.CSSProperties,
    alert: (type: "error" | "success") => ({
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "12px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: 500,
      marginBottom: "16px",
      background: type === "error" ? "#fef2f2" : "#f0fdf4",
      color: type === "error" ? "#991b1b" : "#166534",
      border: `1px solid ${type === "error" ? "#fecaca" : "#bbf7d0"}`,
    } as React.CSSProperties),
    alertClose: {
      marginLeft: "auto",
      background: "none",
      border: "none",
      cursor: "pointer",
      fontSize: "16px",
      color: "inherit",
      opacity: 0.6,
    } as React.CSSProperties,
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "20px",
      alignItems: "start",
    } as React.CSSProperties,
    card: {
      background: "#ffffff",
      borderRadius: "12px",
      border: "1px solid #e2e8f0",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      overflow: "hidden",
    } as React.CSSProperties,
    cardHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 20px",
      borderBottom: "1px solid #f1f5f9",
      background: "#fafbfc",
    } as React.CSSProperties,
    cardTitle: {
      fontSize: "14px",
      fontWeight: 600,
      color: "#0f172a",
      margin: 0,
    } as React.CSSProperties,
    cardBody: {
      padding: "20px",
    } as React.CSSProperties,
    formGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "14px",
    } as React.CSSProperties,
    formField: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "4px",
    } as React.CSSProperties,
    formFieldFull: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "4px",
      gridColumn: "1 / -1",
    } as React.CSSProperties,
    label: {
      fontSize: "11px",
      fontWeight: 600,
      color: "#64748b",
      textTransform: "uppercase" as const,
      letterSpacing: "0.3px",
    } as React.CSSProperties,
    input: {
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "9px 12px",
      fontSize: "13px",
      color: "#1e293b",
      background: "#ffffff",
      outline: "none",
      transition: "border-color 0.15s, box-shadow 0.15s",
    } as React.CSSProperties,
    select: {
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "9px 12px",
      fontSize: "13px",
      color: "#1e293b",
      background: "#ffffff",
      outline: "none",
      cursor: "pointer",
    } as React.CSSProperties,
    checkboxRow: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "12px",
      color: "#475569",
    } as React.CSSProperties,
    formActions: {
      display: "flex",
      gap: "10px",
      marginTop: "16px",
      paddingTop: "16px",
      borderTop: "1px solid #f1f5f9",
    } as React.CSSProperties,
    btnPrimary: {
      border: "none",
      borderRadius: "8px",
      padding: "10px 20px",
      background: "linear-gradient(135deg, #1e40af 0%, #2563eb 100%)",
      color: "#ffffff",
      fontSize: "13px",
      fontWeight: 600,
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
      transition: "all 0.15s",
    } as React.CSSProperties,
    btnSecondary: {
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      padding: "10px 16px",
      background: "#ffffff",
      color: "#475569",
      fontSize: "13px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s",
    } as React.CSSProperties,
    btnDanger: {
      border: "none",
      borderRadius: "6px",
      padding: "7px 14px",
      background: "#fee2e2",
      color: "#991b1b",
      fontSize: "12px",
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.15s",
    } as React.CSSProperties,
    btnSmall: {
      border: "1px solid #e2e8f0",
      borderRadius: "6px",
      padding: "7px 14px",
      background: "#ffffff",
      color: "#475569",
      fontSize: "12px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s",
    } as React.CSSProperties,
    mailboxItem: {
      padding: "16px 20px",
      borderBottom: "1px solid #f1f5f9",
      transition: "background 0.1s",
    } as React.CSSProperties,
    mailboxHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px",
    } as React.CSSProperties,
    mailboxName: {
      fontSize: "14px",
      fontWeight: 600,
      color: "#0f172a",
      margin: 0,
    } as React.CSSProperties,
    mailboxEmail: {
      fontSize: "12px",
      color: "#64748b",
      margin: "2px 0 0",
    } as React.CSSProperties,
    badge: (colors: { bg: string; color: string; border: string }) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "3px 10px",
      borderRadius: "20px",
      fontSize: "11px",
      fontWeight: 600,
      background: colors.bg,
      color: colors.color,
      border: `1px solid ${colors.border}`,
    } as React.CSSProperties),
    metaGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gap: "6px",
      marginBottom: "10px",
    } as React.CSSProperties,
    metaItem: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "1px",
    } as React.CSSProperties,
    metaLabel: {
      fontSize: "10px",
      color: "#94a3b8",
      textTransform: "uppercase" as const,
      letterSpacing: "0.3px",
      fontWeight: 600,
    } as React.CSSProperties,
    metaValue: {
      fontSize: "12px",
      color: "#334155",
      fontWeight: 500,
    } as React.CSSProperties,
    mailboxActions: {
      display: "flex",
      gap: "8px",
      marginTop: "10px",
    } as React.CSSProperties,
    errorText: {
      fontSize: "12px",
      color: "#dc2626",
      margin: "6px 0",
      padding: "6px 10px",
      background: "#fef2f2",
      borderRadius: "6px",
      border: "1px solid #fecaca",
    } as React.CSSProperties,
    timestamps: {
      display: "flex",
      gap: "16px",
      fontSize: "11px",
      color: "#94a3b8",
      marginTop: "8px",
    } as React.CSSProperties,
    emptyState: {
      padding: "40px 20px",
      textAlign: "center" as const,
      color: "#94a3b8",
      fontSize: "13px",
    } as React.CSSProperties,
    collapseBtn: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontSize: "12px",
      color: "#64748b",
      fontWeight: 500,
      padding: "4px 8px",
      borderRadius: "4px",
    } as React.CSSProperties,
  };

  if (!canManage && !loading) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={{ ...styles.card, padding: "40px", textAlign: "center" }}>
            <p style={{ fontSize: "14px", color: "#64748b" }}>
              Só os proprietários ou administradores da empresa podem gerir mailboxes IMAP.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const connectedCount = mailboxes.filter((m) => m.status === "connected").length;
  const configuredCount = mailboxes.filter((m) => ["configured", "connected"].includes(m.status)).length;
  const readWriteCount = mailboxes.filter((m) => m.access_mode === "read_write").length;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.breadcrumb}>Via Oceânica AI &middot; Administração de Email</div>
          <h1 style={styles.title}>Gestão de Mailboxes</h1>
          <p style={styles.subtitle}>
            Configure as caixas IMAP que o módulo deve ler, sincronizar e gerir. As palavras-passe ficam guardadas no servidor.
          </p>
        </div>

        {/* Stats */}
        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Total de Caixas</div>
            <div style={styles.statValue}>{mailboxes.length}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Ligadas</div>
            <div style={{ ...styles.statValue, color: "#16a34a" }}>{connectedCount}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Configuradas</div>
            <div style={{ ...styles.statValue, color: "#d97706" }}>{configuredCount}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Leitura/Escrita</div>
            <div style={{ ...styles.statValue, color: "#2563eb" }}>{readWriteCount}</div>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div style={styles.alert("error")}>
            <span>⚠</span>
            <span>{error}</span>
            <button style={styles.alertClose} onClick={() => setError("")}>✕</button>
          </div>
        )}
        {success && (
          <div style={styles.alert("success")}>
            <span>✓</span>
            <span>{success}</span>
            <button style={styles.alertClose} onClick={() => setSuccess("")}>✕</button>
          </div>
        )}

        {/* Main Grid */}
        <div style={styles.grid}>
          {/* Form Card */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>
                {editingId ? "✏️ Editar Caixa" : "➕ Adicionar Caixa"}
              </h2>
              <button style={styles.collapseBtn} onClick={() => setFormCollapsed(!formCollapsed)}>
                {formCollapsed ? "Expandir ▾" : "Recolher ▴"}
              </button>
            </div>

            {!formCollapsed && (
              <div style={styles.cardBody}>
                <div style={styles.formGrid}>
                  <div style={styles.formField}>
                    <span style={styles.label}>Nome visível</span>
                    <input
                      style={styles.input}
                      value={form.name}
                      onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Ex: Caixa de suporte"
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Endereço de email</span>
                    <input
                      style={styles.input}
                      type="email"
                      value={form.email_address}
                      onChange={(e) => setForm((s) => ({ ...s, email_address: e.target.value }))}
                      placeholder="suporte@empresa.com"
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Servidor IMAP</span>
                    <input
                      style={styles.input}
                      value={form.imap_host}
                      onChange={(e) => setForm((s) => ({ ...s, imap_host: e.target.value }))}
                      placeholder="imap.empresa.com"
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Porta IMAP</span>
                    <input
                      style={styles.input}
                      type="number"
                      value={form.imap_port}
                      onChange={(e) => setForm((s) => ({ ...s, imap_port: e.target.value }))}
                      placeholder="993"
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Utilizador IMAP</span>
                    <input
                      style={styles.input}
                      value={form.imap_username}
                      onChange={(e) => setForm((s) => ({ ...s, imap_username: e.target.value }))}
                      placeholder="suporte@empresa.com"
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>
                      Palavra-passe {editingId ? "(em branco = manter)" : ""}
                    </span>
                    <input
                      style={styles.input}
                      type="password"
                      value={form.imap_password}
                      onChange={(e) => setForm((s) => ({ ...s, imap_password: e.target.value }))}
                      placeholder={editingId ? "••••••••" : "Palavra-passe IMAP"}
                    />
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Segurança</span>
                    <select
                      style={styles.select}
                      value={form.security_mode}
                      onChange={(e) => updateSecurityMode(e.target.value as MailboxFormState["security_mode"])}
                    >
                      <option value="ssl_tls">SSL/TLS (porta 993)</option>
                      <option value="starttls">STARTTLS (porta 143)</option>
                      <option value="none">Sem encriptação (porta 143)</option>
                    </select>
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Modo de acesso</span>
                    <select
                      style={styles.select}
                      value={form.access_mode}
                      onChange={(e) => setForm((s) => ({ ...s, access_mode: e.target.value as MailboxFormState["access_mode"] }))}
                    >
                      <option value="read_write">Leitura e escrita</option>
                      <option value="read_only">Só leitura</option>
                    </select>
                  </div>

                  <div style={styles.formField}>
                    <span style={styles.label}>Pasta</span>
                    <input
                      style={styles.input}
                      value={form.folder}
                      onChange={(e) => setForm((s) => ({ ...s, folder: e.target.value }))}
                      placeholder="INBOX"
                    />
                  </div>

                  <div style={{ ...styles.formField, justifyContent: "flex-end" }}>
                    <label style={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={form.validate_certificates}
                        onChange={(e) => setForm((s) => ({ ...s, validate_certificates: e.target.checked }))}
                      />
                      Validar certificados SSL/TLS
                    </label>
                    <label style={{ ...styles.checkboxRow, marginTop: "6px" }}>
                      <input
                        type="checkbox"
                        checked={form.sync_enabled}
                        onChange={(e) => setForm((s) => ({ ...s, sync_enabled: e.target.checked }))}
                      />
                      Sincronizar após guardar
                    </label>
                  </div>
                </div>

                <div style={styles.formActions}>
                  <button
                    style={{ ...styles.btnPrimary, opacity: submitting ? 0.6 : 1 }}
                    disabled={submitting}
                    onClick={() => void submitForm()}
                  >
                    {submitting ? "A guardar..." : editingId ? "💾 Guardar alterações" : "➕ Adicionar caixa"}
                  </button>
                  <button
                    style={styles.btnSecondary}
                    disabled={submitting}
                    onClick={resetForm}
                  >
                    {editingId ? "Cancelar" : "Limpar"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mailboxes List Card */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>📬 Caixas Configuradas</h2>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                {mailboxes.length} {mailboxes.length === 1 ? "caixa" : "caixas"}
              </span>
            </div>

            {loading ? (
              <div style={styles.emptyState}>A carregar...</div>
            ) : mailboxes.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={{ margin: "0 0 4px", fontSize: "15px" }}>📭</p>
                <p style={{ margin: 0 }}>Nenhuma mailbox configurada.</p>
                <p style={{ margin: "4px 0 0", fontSize: "12px" }}>Use o formulário ao lado para adicionar a primeira.</p>
              </div>
            ) : (
              <div>
                {mailboxes.map((item) => {
                  const colors = statusColor(item.status);
                  return (
                    <div key={item.id} style={styles.mailboxItem}>
                      <div style={styles.mailboxHeader}>
                        <div>
                          <p style={styles.mailboxName}>{item.name}</p>
                          <p style={styles.mailboxEmail}>{item.email_address}</p>
                        </div>
                        <span style={styles.badge(colors)}>
                          {item.status === "connected" ? "●" : "○"} {mailboxStatusLabel(item.status)}
                        </span>
                      </div>

                      <div style={styles.metaGrid}>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Servidor</span>
                          <span style={styles.metaValue}>{item.imap_host || "—"}</span>
                        </div>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Porta</span>
                          <span style={styles.metaValue}>{item.imap_port || "—"}</span>
                        </div>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Segurança</span>
                          <span style={styles.metaValue}>{connectionLabel(item.security_mode)}</span>
                        </div>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Pasta</span>
                          <span style={styles.metaValue}>{item.folder || "INBOX"}</span>
                        </div>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Acesso</span>
                          <span style={styles.metaValue}>{item.access_mode === "read_write" ? "Leitura/Escrita" : "Só leitura"}</span>
                        </div>
                        <div style={styles.metaItem}>
                          <span style={styles.metaLabel}>Palavra-passe</span>
                          <span style={styles.metaValue}>{item.has_password ? "✓ Guardada" : "⚠ Em falta"}</span>
                        </div>
                      </div>

                      {item.last_error && (
                        <div style={styles.errorText}>
                          Último erro: {item.last_error}
                        </div>
                      )}

                      <div style={styles.timestamps}>
                        <span>Teste: {formatDate(item.last_connection_test_at)}</span>
                        <span>Sync: {formatDate(item.last_synced_at)}</span>
                        <span>Atualizada: {formatDate(item.updated_at)}</span>
                      </div>

                      <div style={styles.mailboxActions}>
                        <button style={styles.btnSmall} onClick={() => startEdit(item)}>
                          ✏️ Editar
                        </button>
                        <button
                          style={{ ...styles.btnSmall, color: testingId === item.id ? "#94a3b8" : "#2563eb" }}
                          disabled={testingId === item.id}
                          onClick={() => void testConnection(item.id)}
                        >
                          {testingId === item.id ? "⏳ A testar..." : "🔌 Testar ligação"}
                        </button>
                        <button style={styles.btnDanger} onClick={() => void deleteMailbox(item.id)}>
                          🗑 Apagar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
