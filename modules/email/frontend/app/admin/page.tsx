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

function statusClass(status: string) {
  if (["connected"].includes(status)) return "tag success";
  if (["configured", "paused"].includes(status)) return "tag warning";
  return "tag";
}

function connectionLabel(securityMode: AdminMailbox["security_mode"]) {
  if (securityMode === "ssl_tls") return "SSL/TLS direto";
  if (securityMode === "starttls") return "STARTTLS";
  return "Sem encriptação";
}

function mailboxStatusLabel(status?: string | null) {
  switch ((status || "").toLowerCase()) {
    case "connected":
      return "ligada";
    case "configured":
      return "configurada";
    case "paused":
      return "em pausa";
    case "error":
      return "erro";
    default:
      return status || "—";
  }
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.top === window.self) {
      window.location.replace(`/dashboard/module/email?view=admin${window.location.search ? `&${window.location.search.slice(1)}` : ""}`);
    }
  }, []);

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
    } catch {
      // ignore
    }

    const readyTimer = window.setTimeout(() => {
      setContextReady(true);
    }, 400);

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
      setError("Não foi possível obter o contexto da empresa a partir da aplicação principal Via Oceânica AI.");
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
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders(tenantId),
        },
        body: JSON.stringify({
          ...form,
          imap_port: Number(form.imap_port),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao guardar a caixa IMAP");
      }
      setSuccess(editingId ? "Caixa atualizada." : "Caixa criada.");
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
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/admin/mailboxes/${mailboxId}`, {
        method: "DELETE",
        headers: buildHeaders(tenantId),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao apagar a caixa");
      }
      if (editingId === mailboxId) resetForm();
      setSuccess("Caixa removida.");
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
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders(tenantId),
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao testar ligação IMAP");
      }
      const message = payload?.data?.test_result?.message || "Ligação IMAP validada.";
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
    setForm({
      name: mailbox.name || "",
      email_address: mailbox.email_address || "",
      imap_host: mailbox.imap_host || "",
      imap_port: String(mailbox.imap_port || (mailbox.security_mode === "ssl_tls" ? 993 : 143)),
      imap_username: mailbox.imap_username || "",
      imap_password: "",
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

  if (!canManage && !loading) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>Administração de Email</h1>
          <p className="lead">Só os proprietários ou administradores da empresa podem gerir mailboxes IMAP.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <section className="hero">
          <div className="hero-top">
            <div>
              <div className="eyebrow">Via Oceânica AI · Administração de Email</div>
              <h1 className="title">Administração de mailboxes</h1>
              <p className="subtitle">
                Configure as mailboxes IMAP que o módulo deve ler, sincronizar e gerir. As palavras-passe ficam guardadas no servidor e nunca regressam ao navegador.
              </p>
            </div>
            <div className="pill">
              <span>🔐</span>
              <span>{mailboxes.length} caixa{mailboxes.length === 1 ? "" : "s"} configurada{mailboxes.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Empresa</div>
              <div className="kpi-value">{tenantId || "—"}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Ligadas</div>
              <div className="kpi-value">{mailboxes.filter((item) => item.status === "connected").length}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Configuradas</div>
              <div className="kpi-value">{mailboxes.filter((item) => ["configured", "connected"].includes(item.status)).length}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Com escrita</div>
              <div className="kpi-value">{mailboxes.filter((item) => item.access_mode === "read_write").length}</div>
            </div>
          </div>
        </section>

        {error ? (
          <section className="panel">
            <h2>Erro</h2>
            <p className="lead">{error}</p>
          </section>
        ) : null}

        {success ? (
          <section className="panel">
            <h2>Concluído</h2>
            <p className="lead">{success}</p>
          </section>
        ) : null}

        <section className="grid admin-grid">
          <article className="panel col-5 admin-panel-sticky">
            <h2>{editingId ? "Editar caixa de email" : "Adicionar caixa de email"}</h2>
            <p className="lead">Defina host IMAP, TLS, porta, pasta e permissões de acesso.</p>

            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Nome visível</span>
                <input className="admin-input" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Caixa de suporte" />
              </label>

              <label className="admin-field">
                <span>Endereço de email</span>
                <input className="admin-input" type="email" value={form.email_address} onChange={(e) => setForm((s) => ({ ...s, email_address: e.target.value }))} placeholder="support@example.com" />
              </label>

              <label className="admin-field">
                <span>Servidor IMAP</span>
                <input className="admin-input" value={form.imap_host} onChange={(e) => setForm((s) => ({ ...s, imap_host: e.target.value }))} placeholder="imap.example.com" />
              </label>

              <label className="admin-field">
                <span>Porta IMAP</span>
                <input className="admin-input" type="number" value={form.imap_port} onChange={(e) => setForm((s) => ({ ...s, imap_port: e.target.value }))} placeholder="993" />
              </label>

              <label className="admin-field">
                <span>Utilizador IMAP</span>
                <input className="admin-input" value={form.imap_username} onChange={(e) => setForm((s) => ({ ...s, imap_username: e.target.value }))} placeholder="support@example.com" />
              </label>

              <label className="admin-field">
                <span>Palavra-passe {editingId ? "(deixe em branco para manter a atual)" : ""}</span>
                <input className="admin-input" type="password" value={form.imap_password} onChange={(e) => setForm((s) => ({ ...s, imap_password: e.target.value }))} placeholder={editingId ? "A palavra-passe guardada será mantida" : "Palavra-passe da mailbox ou app password"} />
              </label>

              <label className="admin-field">
                <span>Segurança da ligação</span>
                <select className="admin-input" value={form.security_mode} onChange={(e) => updateSecurityMode(e.target.value as MailboxFormState["security_mode"])}>
                  <option value="ssl_tls">SSL/TLS direto, normalmente porta 993</option>
                  <option value="starttls">STARTTLS, normalmente porta 143</option>
                  <option value="none">Sem encriptação, normalmente porta 143</option>
                </select>
              </label>

              <label className="admin-field">
                <span>Modo de acesso</span>
                <select className="admin-input" value={form.access_mode} onChange={(e) => setForm((s) => ({ ...s, access_mode: e.target.value as MailboxFormState["access_mode"] }))}>
                  <option value="read_write">Leitura e escrita, permite marcar e apagar remotamente</option>
                  <option value="read_only">Só leitura, mais seguro para ingestão apenas</option>
                </select>
              </label>

              <label className="admin-field">
                <span>Pasta</span>
                <input className="admin-input" value={form.folder} onChange={(e) => setForm((s) => ({ ...s, folder: e.target.value }))} placeholder="INBOX" />
              </label>

              <label className="admin-checkbox">
                <input type="checkbox" checked={form.validate_certificates} onChange={(e) => setForm((s) => ({ ...s, validate_certificates: e.target.checked }))} />
                <span>Validar certificados SSL/TLS</span>
              </label>

              <label className="admin-checkbox">
                <input type="checkbox" checked={form.sync_enabled} onChange={(e) => setForm((s) => ({ ...s, sync_enabled: e.target.checked }))} />
                <span>Ativar sincronização da mailbox logo após guardar</span>
              </label>
            </div>

            <div className="admin-actions">
              <button className="admin-button" disabled={submitting} onClick={() => void submitForm()}>
                {submitting ? "A guardar..." : editingId ? "Guardar alterações" : "Adicionar caixa"}
              </button>
              <button className="admin-button secondary" disabled={submitting} onClick={resetForm}>
                {editingId ? "Cancelar edição" : "Limpar formulário"}
              </button>
            </div>
          </article>

          <article className="panel col-7">
            <h2>Caixas de email configuradas</h2>
            <p className="lead">Cada caixa inclui servidor IMAP, porta, TLS, pasta e nível de gestão.</p>

            {loading ? (
              <div className="empty">A carregar administração de mailboxes...</div>
            ) : mailboxes.length === 0 ? (
              <div className="empty">Ainda não existem mailboxes IMAP configuradas.</div>
            ) : (
              <div className="list">
                {mailboxes.map((item) => (
                  <div className="item" key={item.id}>
                    <div className="item-top">
                      <div>
                        <p className="item-title">{item.name}</p>
                        <p className="item-subtitle">{item.email_address} · {item.imap_username || "—"}</p>
                      </div>
                      <span className={statusClass(item.status)}>{mailboxStatusLabel(item.status)}</span>
                    </div>

                    <div className="meta">
                      <span className="tag">{item.imap_host || "Servidor em falta"}</span>
                      <span className="tag">Porta {item.imap_port || "—"}</span>
                      <span className="tag">{connectionLabel(item.security_mode)}</span>
                      <span className="tag">Pasta {item.folder || "INBOX"}</span>
                      <span className="tag">{item.access_mode === "read_write" ? "Leitura e escrita" : "Só leitura"}</span>
                      <span className="tag">Validação TLS {item.validate_certificates ? "ativa" : "desligada"}</span>
                      <span className="tag">Palavra-passe {item.has_password ? "guardada" : "em falta"}</span>
                    </div>

                    {item.last_error ? <p className="admin-inline-error">Último erro: {item.last_error}</p> : null}

                    <div className="admin-inline-meta">
                      <span>Último teste {formatDate(item.last_connection_test_at)}</span>
                      <span>Última sincronização {formatDate(item.last_synced_at)}</span>
                      <span>Atualizada {formatDate(item.updated_at)}</span>
                    </div>

                    <div className="admin-actions compact">
                      <button className="admin-button secondary" onClick={() => startEdit(item)}>Editar</button>
                      <button className="admin-button secondary" disabled={testingId === item.id} onClick={() => void testConnection(item.id)}>
                        {testingId === item.id ? "A testar..." : "Testar ligação"}
                      </button>
                      <button className="admin-button danger" onClick={() => void deleteMailbox(item.id)}>Apagar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
