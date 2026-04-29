"use client";

import { useEffect, useMemo, useState } from "react";

type StatusPayload = {
  success: boolean;
  data?: {
    module?: string;
    tenant_id?: string;
    user_id?: string;
    company_role?: string;
    platform_roles?: string[];
    can_manage_mailboxes?: boolean;
    message?: string;
  };
};

type Mailbox = {
  id: string;
  name: string;
  email_address: string;
  provider: string;
  status: string;
  sync_enabled: boolean;
  imap_host?: string | null;
  imap_port?: number | null;
  security_mode: "ssl_tls" | "starttls" | "none";
  access_mode: "read_only" | "read_write";
  folder: string;
  validate_certificates: boolean;
  last_error?: string | null;
  last_synced_at?: string | null;
};

type EmailMessage = {
  id: string;
  mailbox_id: string;
  folder?: string | null;
  subject?: string | null;
  from_name?: string | null;
  from_address?: string | null;
  to_addresses?: string | null;
  snippet?: string | null;
  received_at?: string | null;
  is_seen: boolean;
  is_flagged: boolean;
  has_attachments: boolean;
  remote_deleted: boolean;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  audience: string;
  status: string;
  scheduled_at?: string | null;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
};

type Automation = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  status: string;
};

type DashboardPayload = {
  success: boolean;
  data?: {
    summary?: {
      connected_mailboxes?: number;
      configured_mailboxes?: number;
      active_automations?: number;
      draft_campaigns?: number;
      scheduled_campaigns?: number;
      total_sent?: number;
      stored_emails?: number;
      unread_emails?: number;
    };
    mailboxes?: Mailbox[];
    campaigns?: Campaign[];
    automations?: Automation[];
    latest_emails?: EmailMessage[];
  };
};

type FolderOptionsPayload = {
  success: boolean;
  data?: {
    mailbox_id?: string;
    current_folder?: string;
    folders?: string[];
  };
};

const API_BASE = "/module/email/api-proxy";

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
  if (["connected", "active", "sent"].includes(status)) return "tag success";
  if (["configured", "paused", "scheduled"].includes(status)) return "tag warning";
  return "tag";
}

function mailboxSecurityLabel(mode: Mailbox["security_mode"]) {
  if (mode === "ssl_tls") return "SSL/TLS";
  if (mode === "starttls") return "STARTTLS";
  return "IMAP simples";
}

function mailboxAccessLabel(mode: Mailbox["access_mode"]) {
  return mode === "read_write" ? "Leitura e escrita" : "Só leitura";
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

function campaignStatusLabel(status?: string | null) {
  switch ((status || "").toLowerCase()) {
    case "draft":
      return "rascunho";
    case "scheduled":
      return "agendada";
    case "sent":
      return "enviada";
    case "active":
      return "ativa";
    case "paused":
      return "em pausa";
    default:
      return status || "—";
  }
}

export default function EmailPage() {
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [platformRoles, setPlatformRoles] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState("");
  const [folderOptionsByMailbox, setFolderOptionsByMailbox] = useState<Record<string, string[]>>({});
  const [moveTargetByEmail, setMoveTargetByEmail] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [syncingMailboxId, setSyncingMailboxId] = useState<string | null>(null);
  const [actioningEmailId, setActioningEmailId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.top === window.self) {
      const suffix = window.location.search || "";
      window.location.replace(`/dashboard/module/email${suffix}`);
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

  async function loadDashboard(activeTenantId: string) {
    const headers = buildHeaders(activeTenantId);
    const [statusRes, dashboardRes] = await Promise.all([
      fetch(`${API_BASE}/api/status`, { headers }),
      fetch(`${API_BASE}/api/dashboard`, { headers }),
    ]);

    const statusJson = (await statusRes.json()) as StatusPayload;
    const dashboardJson = (await dashboardRes.json()) as DashboardPayload;

    if (!statusRes.ok) {
      throw new Error(statusJson?.data?.message || "Falha ao carregar o estado do módulo Email");
    }
    if (!dashboardRes.ok) {
      throw new Error("Falha ao carregar o espaço de trabalho de Email");
    }

    setStatus(statusJson);
    setDashboard(dashboardJson);

    const nextMailboxes = dashboardJson?.data?.mailboxes || [];
    if (nextMailboxes.length === 0) {
      setSelectedMailboxId("");
      setEmails([]);
      return;
    }

    setSelectedMailboxId((current) => {
      if (current && nextMailboxes.some((item) => item.id === current)) return current;
      return nextMailboxes[0]?.id || "";
    });
  }

  async function loadEmails(activeTenantId: string, mailboxId?: string) {
    setMailLoading(true);
    try {
      const headers = buildHeaders(activeTenantId);
      const url = mailboxId ? `${API_BASE}/api/emails?mailbox_id=${encodeURIComponent(mailboxId)}` : `${API_BASE}/api/emails`;
      const response = await fetch(url, { headers });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao carregar os emails sincronizados");
      }
      setEmails(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      setMailLoading(false);
    }
  }

  async function loadFolders(activeTenantId: string, mailboxId: string) {
    setFoldersLoading(true);
    try {
      const headers = buildHeaders(activeTenantId);
      const response = await fetch(`${API_BASE}/api/mailboxes/${mailboxId}/folders`, { headers });
      const payload = (await response.json()) as FolderOptionsPayload;
      if (!response.ok) {
        throw new Error(payload?.data?.current_folder || "Falha ao carregar as pastas da mailbox");
      }
      const folders = Array.isArray(payload?.data?.folders) ? payload.data?.folders || [] : [];
      setFolderOptionsByMailbox((current) => ({ ...current, [mailboxId]: folders }));
    } finally {
      setFoldersLoading(false);
    }
  }

  useEffect(() => {
    if (!contextReady) return;

    if (!tenantId) {
      setLoading(false);
      setError("Não foi possível obter o contexto da empresa a partir da aplicação principal Via Oceânica AI.");
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      try {
        await loadDashboard(tenantId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar o módulo Email");
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => undefined);
  }, [contextReady, tenantId, userId, companyRole, platformRoles]);

  useEffect(() => {
    if (!tenantId) return;
    loadEmails(tenantId, selectedMailboxId || undefined).catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar os emails");
    });
  }, [tenantId, selectedMailboxId, userId, companyRole, platformRoles]);

  useEffect(() => {
    if (!tenantId || !selectedMailboxId) return;
    loadFolders(tenantId, selectedMailboxId).catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar as pastas da mailbox");
    });
  }, [tenantId, selectedMailboxId, userId, companyRole, platformRoles]);

  useEffect(() => {
    if (!tenantId || !emails.length) return;
    const mailboxIds = Array.from(new Set(emails.map((item) => item.mailbox_id))).filter(
      (mailboxId) => !folderOptionsByMailbox[mailboxId]
    );
    if (!mailboxIds.length) return;
    Promise.all(
      mailboxIds.map((mailboxId) =>
        loadFolders(tenantId, mailboxId).catch((err) => {
          setError(err instanceof Error ? err.message : "Erro ao carregar as pastas da mailbox");
        })
      )
    ).catch(() => undefined);
  }, [tenantId, emails, folderOptionsByMailbox, userId, companyRole, platformRoles]);

  const summary = dashboard?.data?.summary || {};
  const mailboxes = dashboard?.data?.mailboxes || [];
  const campaigns = dashboard?.data?.campaigns || [];
  const automations = dashboard?.data?.automations || [];
  const selectedMailbox = mailboxes.find((item) => item.id === selectedMailboxId) || null;
  const mailboxMap = useMemo(() => new Map(mailboxes.map((item) => [item.id, item])), [mailboxes]);

  useEffect(() => {
    if (!emails.length) return;
    setMoveTargetByEmail((current) => {
      const next = { ...current };
      for (const item of emails) {
        if (next[item.id]) continue;
        const folders = folderOptionsByMailbox[item.mailbox_id] || [];
        const fallback = folders.find((folder) => folder !== (item.folder || "INBOX")) || item.folder || "INBOX";
        next[item.id] = fallback;
      }
      return next;
    });
  }, [emails, folderOptionsByMailbox]);

  async function refreshAll(preferredMailboxId?: string) {
    if (!tenantId) return;
    const mailboxIdToLoad = preferredMailboxId || selectedMailboxId || undefined;
    await loadDashboard(tenantId);
    await loadEmails(tenantId, mailboxIdToLoad);
  }

  async function syncMailbox(mailboxId: string) {
    if (!tenantId) return;
    setSyncingMailboxId(mailboxId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/mailboxes/${mailboxId}/sync`, {
        method: "POST",
        headers: buildHeaders(tenantId),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao sincronizar a mailbox");
      }
      const syncResult = payload?.data?.sync_result;
      setSuccess(
        syncResult
          ? `Sincronizada ${syncResult.mailbox_name}: ${syncResult.fetched} lidos, ${syncResult.created} novos, ${syncResult.updated} atualizados.`
          : "Sincronização concluída."
      );
      await refreshAll(mailboxId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar a mailbox");
    } finally {
      setSyncingMailboxId(null);
    }
  }

  async function applyEmailAction(
    emailId: string,
    action: "mark_read" | "mark_unread" | "delete" | "move",
    targetFolder?: string
  ) {
    if (!tenantId) return;
    setActioningEmailId(emailId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/emails/${emailId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildHeaders(tenantId),
        },
        body: JSON.stringify({ action, target_folder: targetFolder }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || "Falha ao atualizar o estado remoto do email");
      }
      setSuccess(payload?.data?.message || "Email atualizado.");
      await refreshAll(selectedMailboxId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar o estado do email");
    } finally {
      setActioningEmailId(null);
    }
  }

  return (
    <main className="shell">
      <div className="stack">
        <section className="hero">
          <div className="hero-top">
            <div>
              <div className="eyebrow">Via Oceânica AI · Caixa de email</div>
              <h1 className="title">Centro de controlo de email</h1>
              <p className="subtitle">
                Este módulo corre dentro da aplicação principal Via Oceânica AI e usa o contexto real da empresa. Cada mailbox tem a sua própria pasta, modo TLS e permissões de acesso.
              </p>
            </div>
            <div className="pill">
              <span>✉️</span>
              <span>{status?.data?.message || "A carregar módulo Email"}</span>
            </div>
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Caixas ligadas</div>
              <div className="kpi-value">{summary.connected_mailboxes ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Emails por ler</div>
              <div className="kpi-value">{summary.unread_emails ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Emails guardados</div>
              <div className="kpi-value">{summary.stored_emails ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Automações ativas</div>
              <div className="kpi-value">{summary.active_automations ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Emails enviados</div>
              <div className="kpi-value">{summary.total_sent ?? 0}</div>
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

        <section className="grid">
          <article className="panel col-5">
            <h2>Caixas de email</h2>
            <p className="lead">Pasta IMAP, modo de segurança e controlo de sincronização por caixa.</p>
            {loading ? (
              <div className="empty">A carregar mailboxes...</div>
            ) : mailboxes.length === 0 ? (
              <div className="empty">Ainda não existem mailboxes IMAP configuradas.</div>
            ) : (
              <div className="list">
                {mailboxes.map((item) => (
                  <div
                    className={`item selectable ${selectedMailboxId === item.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedMailboxId(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedMailboxId(item.id);
                      }
                    }}
                  >
                    <div className="item-top">
                      <div>
                        <p className="item-title">{item.name}</p>
                        <p className="item-subtitle">{item.email_address}</p>
                      </div>
                      <span className={statusClass(item.status)}>{mailboxStatusLabel(item.status)}</span>
                    </div>
                    <div className="meta">
                      <span className="tag">Pasta {item.folder || "INBOX"}</span>
                      <span className="tag">{mailboxSecurityLabel(item.security_mode)}</span>
                      <span className="tag">{mailboxAccessLabel(item.access_mode)}</span>
                      <span className="tag">Porta {item.imap_port || "—"}</span>
                      <span className="tag">Sincronização {item.sync_enabled ? "ativa" : "desligada"}</span>
                    </div>
                    {item.last_error ? <p className="admin-inline-error">Último erro: {item.last_error}</p> : null}
                    <div className="admin-inline-meta">
                      <span>Última sincronização {formatDate(item.last_synced_at)}</span>
                      <span>Validação TLS {item.validate_certificates ? "ativa" : "desligada"}</span>
                    </div>
                    <div className="admin-actions compact">
                      <button
                        className="admin-button secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void syncMailbox(item.id);
                        }}
                        disabled={syncingMailboxId === item.id || !item.sync_enabled}
                      >
                        {syncingMailboxId === item.id ? "A sincronizar..." : "Sincronizar agora"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel col-7">
            <div className="item-top">
              <div>
                <h2>Caixa de entrada</h2>
                <p className="lead">
                  {selectedMailbox
                    ? `${selectedMailbox.name} · ${selectedMailbox.folder} · ${mailboxAccessLabel(selectedMailbox.access_mode)}`
                    : "Mensagens sincronizadas das mailboxes configuradas."}
                </p>
              </div>
              {selectedMailbox ? (
                <button
                  className="admin-button secondary"
                  onClick={() => setSelectedMailboxId("")}
                >
                  Ver todas
                </button>
              ) : null}
            </div>

            {selectedMailbox && selectedMailbox.access_mode !== "read_write" ? (
              <p className="footer-note">Esta mailbox está em modo só de leitura, por isso as ações remotas estão desativadas.</p>
            ) : null}

            {selectedMailbox && selectedMailbox.access_mode === "read_write" ? (
              <p className="footer-note">
                {foldersLoading ? "A carregar pastas de destino..." : "As ações de mover usam a lista real de pastas IMAP da mailbox selecionada."}
              </p>
            ) : null}

            {mailLoading ? (
              <div className="empty">A carregar emails sincronizados...</div>
            ) : emails.length === 0 ? (
              <div className="empty">Ainda não existem emails guardados. Execute primeiro uma sincronização.</div>
            ) : (
              <div className="list">
                {emails.map((item) => {
                  const mailbox = mailboxMap.get(item.mailbox_id);
                  const canWrite = mailbox?.access_mode === "read_write" && !item.remote_deleted;
                  const folderOptions = folderOptionsByMailbox[item.mailbox_id] || [];
                  const moveTarget = moveTargetByEmail[item.id] || "";
                  const canMove = canWrite && !!moveTarget && moveTarget !== (item.folder || "INBOX");
                  return (
                    <div className="item" key={item.id}>
                      <div className="item-top">
                        <div>
                          <p className="item-title">{item.subject || "(Sem assunto)"}</p>
                          <p className="item-subtitle">
                            {(item.from_name || item.from_address || "Remetente desconhecido")} · {formatDate(item.received_at)}
                          </p>
                        </div>
                        <span className={statusClass(item.is_seen ? "configured" : "connected")}>
                          {item.is_seen ? "lido" : "por ler"}
                        </span>
                      </div>
                      <div className="meta">
                        <span className="tag">Caixa {mailbox?.name || item.mailbox_id}</span>
                        <span className="tag">Pasta {item.folder || mailbox?.folder || "INBOX"}</span>
                        <span className="tag">{mailboxAccessLabel(mailbox?.access_mode || "read_only")}</span>
                        {item.has_attachments ? <span className="tag">Anexos</span> : null}
                        {item.to_addresses ? <span className="tag">Para {item.to_addresses}</span> : null}
                      </div>
                      {item.snippet ? <p className="message-snippet">{item.snippet}</p> : null}
                      {canWrite ? (
                        <div className="move-row">
                          <select
                            className="admin-input"
                            value={moveTarget}
                            onChange={(event) =>
                              setMoveTargetByEmail((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Selecionar pasta</option>
                            {folderOptions.map((folder) => (
                              <option key={`${item.id}-${folder}`} value={folder}>
                                {folder}
                              </option>
                            ))}
                          </select>
                          <button
                            className="admin-button secondary"
                            disabled={!canMove || actioningEmailId === item.id || foldersLoading}
                            onClick={() => void applyEmailAction(item.id, "move", moveTarget)}
                          >
                            Mover
                          </button>
                        </div>
                      ) : null}
                      <div className="admin-actions compact">
                        <button
                          className="admin-button secondary"
                          disabled={!canWrite || actioningEmailId === item.id || item.is_seen}
                          onClick={() => void applyEmailAction(item.id, "mark_read")}
                        >
                          Marcar como lido
                        </button>
                        <button
                          className="admin-button secondary"
                          disabled={!canWrite || actioningEmailId === item.id || !item.is_seen}
                          onClick={() => void applyEmailAction(item.id, "mark_unread")}
                        >
                          Marcar como por ler
                        </button>
                        <button
                          className="admin-button danger"
                          disabled={!canWrite || actioningEmailId === item.id}
                          onClick={() => void applyEmailAction(item.id, "delete")}
                        >
                          Apagar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="panel col-7">
            <h2>Campanhas</h2>
            <p className="lead">Campanhas em rascunho e agendadas para a empresa atual.</p>
            {loading ? (
              <div className="empty">A carregar campanhas...</div>
            ) : campaigns.length === 0 ? (
              <div className="empty">Ainda não existem campanhas.</div>
            ) : (
              <div className="list">
                {campaigns.map((item) => (
                  <div className="item" key={item.id}>
                    <div className="item-top">
                      <div>
                        <p className="item-title">{item.name}</p>
                        <p className="item-subtitle">{item.subject}</p>
                      </div>
                      <span className={statusClass(item.status)}>{campaignStatusLabel(item.status)}</span>
                    </div>
                    <div className="meta">
                      <span className="tag">Público {item.audience}</span>
                      <span className="tag">Enviados {item.sent_count}</span>
                      <span className="tag">Abertos {item.opened_count}</span>
                      <span className="tag">Cliques {item.clicked_count}</span>
                      <span className="tag">Agendamento {formatDate(item.scheduled_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel col-5">
            <h2>Automações</h2>
            <p className="lead">Regras de automação configuradas para a empresa atual.</p>
            {loading ? (
              <div className="empty">A carregar automações...</div>
            ) : automations.length === 0 ? (
              <div className="empty">Ainda não existem automações.</div>
            ) : (
              <div className="list">
                {automations.map((item) => (
                  <div className="item" key={item.id}>
                    <div className="item-top">
                      <div>
                        <p className="item-title">{item.name}</p>
                        <p className="item-subtitle">Disparador {item.trigger}</p>
                      </div>
                      <span className={statusClass(item.status)}>{campaignStatusLabel(item.status)}</span>
                    </div>
                    <div className="meta">
                      <span className="tag">{item.action}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="panel">
          <h2>Contexto da empresa</h2>
          <p className="lead">
            Empresa <strong>{tenantId || "—"}</strong>, utilizador <strong>{userId || "—"}</strong>, perfil <strong>{companyRole || "membro"}</strong>.
          </p>
          <p className="footer-note">
            A configuração das mailboxes fica no painel de administração de Email. Esta vista principal cobre sincronização, revisão da caixa de entrada e ações remotas básicas em mailboxes IMAP com escrita.
          </p>
        </section>
      </div>
    </main>
  );
}
