"use client";

import React, { useEffect, useState } from "react";
import {
  type AdminCatalogResource,
  type PlatformMember,
  type TicketStatusResponse,
  cardClass,
  fieldClass,
  getApiBase,
  getPlatformApiBase,
  rolePill,
} from "../lib";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatCatalogValue(value?: string | null) {
  if (value === undefined || value === null || value === "") return "—";
  if (value === "true") return "Sim";
  if (value === "false") return "Não";
  return value;
}

function formatCatalogKey(key: string) {
  const known: Record<string, string> = {
    responseTime: "Tempo de resposta",
    resolutionTime: "Tempo de resolução",
    body_pt_pt: "Mensagem pt-PT",
    isFinal: "Estado final",
    company_name: "Nome da empresa",
    company_role: "Papel",
    platform_user_id: "Utilizador do portal",
    source: "Origem",
    team: "Equipa",
    resource_type: "Tipo de catálogo",
    updated_at: "Atualizado em",
    created_at: "Criado em",
    tenant_id: "Tenant",
  };
  if (known[key]) return known[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function HelpdeskAdminPageContent() {
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [platformRoles, setPlatformRoles] = useState("");
  const [status, setStatus] = useState<TicketStatusResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adminCatalog, setAdminCatalog] = useState<Record<string, AdminCatalogResource>>({});
  const [activeAdminResource, setActiveAdminResource] = useState("clients");
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<PlatformMember[]>([]);

  const tenantReady = tenantId.trim().length > 0;
  const effectiveCompanyRole = status?.data?.company_role || companyRole || "member";
  const platformRoleSet = new Set(platformRoles.split(",").map((role) => role.trim()).filter(Boolean));
  const canManage = ["owner", "admin"].includes(effectiveCompanyRole) || platformRoleSet.has("admin");

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

    const standaloneFallback = window.setTimeout(async () => {
      if (window.parent !== window) return;
      try {
        const response = await fetch(`${getApiBase()}/api/status`, { credentials: "include" });
        const payload = (await response.json()) as TicketStatusResponse;
        const fallbackTenantId = payload?.data?.tenant_id;
        if (fallbackTenantId) setTenantId(String(fallbackTenantId));
        if (payload?.data) {
          setStatus(payload);
          if (payload.data.company_role) setCompanyRole(payload.data.company_role);
        }
      } catch {
        setTenantId((prev) => prev || "demo");
      }
    }, 500);

    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(standaloneFallback);
    };
  }, []);

  function buildModuleHeaders(activeTenantId: string) {
    return {
      "x-tenant-id": activeTenantId,
      "x-viao-tenant-id": activeTenantId,
      ...(userId ? { "x-viao-user-id": userId } : {}),
      ...(companyRole ? { "x-viao-company-role": companyRole } : {}),
      ...(platformRoles ? { "x-viao-platform-roles": platformRoles } : {}),
    };
  }

  function resetAdminForm(resourceKey: string, catalog: Record<string, AdminCatalogResource>) {
    const resource = catalog[resourceKey];
    if (!resource) return;
    setEditingAdminId(null);
    setAdminForm(Object.fromEntries(resource.fields.map((field) => [field.key, ""])));
  }

  async function loadData(activeTenantId: string) {
    setLoading(true);
    setError("");

    try {
      const headers = buildModuleHeaders(activeTenantId);

      const statusRes = await fetch(`${getApiBase()}/api/status`, { headers });
      const statusJson = (await statusRes.json()) as TicketStatusResponse;
      setStatus(statusJson);

      const catalogRes = await fetch(`${getApiBase()}/api/admin/catalog`, { headers });
      const catalogJson = (await catalogRes.json()) as { success?: boolean; data?: Record<string, AdminCatalogResource>; detail?: string };

      if (!catalogRes.ok || !catalogJson?.data) {
        throw new Error(catalogJson?.detail || "Falha ao carregar catálogos administrativos");
      }

      const catalogEntries = await Promise.all(
        Object.entries(catalogJson.data).map(async ([resourceKey, resource]) => {
          const response = await fetch(`${getApiBase()}/api/admin/catalog/${resourceKey}`, { headers });
          const payload = await response.json();
          return [resourceKey, { ...resource, items: Array.isArray(payload?.data?.items) ? payload.data.items : [] }] as const;
        })
      );

      const nextCatalog = Object.fromEntries(catalogEntries);
      setAdminCatalog(nextCatalog);

      const populatedResourceKey = Object.entries(nextCatalog).find(([, resource]) => (resource.items?.length || 0) > 0)?.[0];
      const nextActiveResource =
        nextCatalog[activeAdminResource]?.items?.length
          ? activeAdminResource
          : populatedResourceKey || Object.keys(nextCatalog)[0] || "clients";
      setActiveAdminResource(nextActiveResource);
      resetAdminForm(nextActiveResource, nextCatalog);

      try {
        const membersRes = await fetch(`${getPlatformApiBase()}/members`, { credentials: "include" });
        const membersJson = await membersRes.json();
        setMembers(Array.isArray(membersJson?.data) ? membersJson.data : []);
      } catch {
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar administração");
    } finally {
      setLoading(false);
    }
  }

  async function submitAdminCatalog() {
    if (!tenantReady) return;
    const resourceKey = activeAdminResource;
    const response = await fetch(`${getApiBase()}/api/admin/catalog/${resourceKey}${editingAdminId ? `/${editingAdminId}` : ""}`, {
      method: editingAdminId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildModuleHeaders(tenantId),
      },
      body: JSON.stringify({ values: adminForm }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail || "Falha ao guardar registo administrativo");
    }
    await loadData(tenantId);
  }

  async function deleteAdminCatalogItem(resourceKey: string, itemId: string) {
    if (!tenantReady) return;
    const response = await fetch(`${getApiBase()}/api/admin/catalog/${resourceKey}/${itemId}`, {
      method: "DELETE",
      headers: buildModuleHeaders(tenantId),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail || "Falha ao apagar registo administrativo");
    }
    await loadData(tenantId);
  }

  useEffect(() => {
    if (!tenantReady) return;
    if (window.parent !== window && !companyRole && !platformRoles) return;
    loadData(tenantId);
  }, [tenantId, companyRole, platformRoles]);

  const activeResource = adminCatalog[activeAdminResource];
  const activeResourceReadOnly = Boolean(activeResource?.read_only);
  const activeFieldLabelMap = new Map((activeResource?.fields || []).map((field) => [field.key, field.label] as const));
  const activeFieldKeys = new Set((activeResource?.fields || []).map((field) => field.key));
  const membersSorted = [...members].sort((a, b) => {
    const aRank = a.companyRole === "owner" ? 2 : a.companyRole === "admin" ? 1 : 0;
    const bRank = b.companyRole === "owner" ? 2 : b.companyRole === "admin" ? 1 : 0;
    return bRank - aRank;
  });

  return (
    <main className="min-h-screen px-4 py-4 text-viao-text sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <section className={cardClass}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-viao-accent2">
                Administração do helpdesk
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-viao-text">Catálogos e operação</h1>
              <p className="mt-2 text-sm leading-6 text-viao-muted">
                Gestão administrativa do módulo Helpdesk dentro do dashboard, com membros reais do tenant disponíveis para atribuição e operação.
              </p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-2xl border border-viao-line bg-viao-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Tenant</div>
                <div className="mt-1 font-medium text-viao-text">{tenantReady ? tenantId : "A aguardar contexto"}</div>
              </div>
              <div className="rounded-2xl border border-viao-line bg-viao-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Papel</div>
                <div className="mt-1 font-medium text-viao-text">{effectiveCompanyRole}</div>
              </div>
              <div className="rounded-2xl border border-viao-line bg-viao-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Acesso</div>
                <div className="mt-1 font-medium text-viao-text">{canManage ? "Administrativo" : "Somente leitura"}</div>
              </div>
              <div className="rounded-2xl border border-viao-line bg-viao-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Estado</div>
                <div className="mt-1 font-medium text-viao-text">{loading ? "A carregar" : status?.data?.message || "Pronto"}</div>
              </div>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className={cardClass}>
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Catálogos</div>
                <h2 className="mt-1 text-lg font-semibold text-viao-text">Configuração</h2>
              </div>

              <div className="grid gap-2">
                {Object.entries(adminCatalog).map(([resourceKey, resource]) => (
                  <button
                    key={resourceKey}
                    onClick={() => {
                      setActiveAdminResource(resourceKey);
                      setEditingAdminId(null);
                      setAdminForm(Object.fromEntries(resource.fields.map((field) => [field.key, ""])));
                    }}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${activeAdminResource === resourceKey ? "border-viao-accent bg-viao-accentLight text-viao-accent2" : "border-viao-line bg-white text-viao-text hover:border-viao-accent/40"}`}
                  >
                    <div className="font-medium">{resource.label}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Equipa</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">Membros do dashboard</h2>
                </div>
                <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1 text-xs text-viao-muted">{membersSorted.length}</span>
              </div>
              <div className="mt-4 space-y-2">
                {membersSorted.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-viao-line bg-viao-panelSoft px-4 py-5 text-sm text-viao-muted">
                    Nenhum membro encontrado para este tenant.
                  </div>
                ) : (
                  membersSorted.map((member) => (
                    <div key={member.id} className="rounded-[18px] border border-viao-line bg-viao-panelSoft px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-viao-text">{member.name || member.email || `Membro ${member.id}`}</div>
                          <div className="mt-1 text-xs text-viao-muted">{member.email || "Sem email"}</div>
                        </div>
                        <span className={rolePill(member.companyRole)}>{member.companyRole || "member"}</span>
                      </div>
                      <div className="mt-2 text-[11px] uppercase tracking-[0.08em] text-viao-muted">{formatDate(member.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="space-y-4">
            <section className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Editor</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">{activeResource?.label || "Catálogo"}</h2>
                </div>
                <div className="rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1.5 text-xs text-viao-accent2">
                  {activeResource?.items?.length || 0}
                </div>
              </div>

              {!activeResource ? (
                <div className="mt-4 rounded-[18px] border border-dashed border-viao-line bg-viao-panelSoft p-4 text-sm text-viao-muted">
                  {loading ? "A carregar catálogos do tenant..." : "Nenhum catálogo disponível."}
                </div>
              ) : activeResourceReadOnly ? (
                <div className="mt-4 rounded-[18px] border border-viao-accent/20 bg-viao-accentLight/40 p-4 text-sm text-viao-accent2">
                  Os técnicos são sincronizados automaticamente a partir da Equipa do portal Via Oceânica AI. Para alterar esta lista, faça a gestão dos membros no portal.
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {activeResource.fields.map((field) => (
                      <input
                        key={field.key}
                        className={fieldClass}
                        placeholder={field.label}
                        value={adminForm[field.key] || ""}
                        onChange={(e) => setAdminForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => submitAdminCatalog().catch((err) => setError(err instanceof Error ? err.message : "Erro ao guardar catálogo"))}
                      disabled={!canManage}
                      className="h-10 rounded-[12px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {editingAdminId ? "Guardar alterações" : "Criar registo"}
                    </button>
                    <button
                      onClick={() => activeResource && resetAdminForm(activeAdminResource, adminCatalog)}
                      className="h-10 rounded-[12px] border border-viao-line bg-white px-4 text-sm font-semibold text-viao-text transition hover:border-viao-accent/40"
                    >
                      Limpar
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Registos</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">Itens do catálogo</h2>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(activeResource?.items || []).map((item) => (
                  <div key={item.id} className="rounded-[18px] border border-viao-line bg-white p-4 shadow-viao">
                    <div className="flex flex-col gap-3 border-b border-viao-line pb-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">{activeResource.label}</div>
                        <div className="mt-1 text-base font-semibold text-viao-text">
                          {formatCatalogValue(item.name || item.code || item.title || item.label || item.email || item.priority || item.trigger || item.body_pt_pt)}
                        </div>
                        <div className="mt-1 text-xs text-viao-muted">
                          ID {item.id.slice(0, 8)} • Atualizado {formatDate(item.updated_at)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em] text-viao-muted xl:justify-end">
                        <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1">{activeResource.label}</span>
                        <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1">{activeResource.items?.length || 0} registos</span>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {activeResource?.fields.map((field) => (
                        <div key={field.key}>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">{field.label}</div>
                          <div className="mt-1 whitespace-pre-line text-sm text-viao-text">{formatCatalogValue(item[field.key])}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 rounded-[16px] border border-viao-line bg-viao-panelSoft p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Conteúdo do registo</div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(item)
                          .filter(
                            ([key, value]) =>
                              !["id", "tenant_id", "resource_type", "created_at", "updated_at"].includes(key) &&
                              !activeFieldKeys.has(key) &&
                              value !== undefined &&
                              value !== null &&
                              value !== ""
                          )
                          .map(([key, value]) => (
                            <div key={key}>
                              <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">{activeFieldLabelMap.get(key) || formatCatalogKey(key)}</div>
                              <div className="mt-1 whitespace-pre-line text-sm text-viao-text">{formatCatalogValue(String(value))}</div>
                            </div>
                          ))}
                      </div>
                      {Object.entries(item).filter(([key, value]) => !["id", "tenant_id", "resource_type", "created_at", "updated_at"].includes(key) && !activeFieldKeys.has(key) && value !== undefined && value !== null && value !== "").length === 0 ? (
                        <div className="mt-2 text-sm text-viao-muted">Sem conteúdo adicional neste registo.</div>
                      ) : null}
                    </div>

                    {!activeResourceReadOnly ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => {
                            if (!activeResource) return;
                            setEditingAdminId(item.id);
                            setAdminForm(Object.fromEntries(activeResource.fields.map((field) => [field.key, item[field.key] || ""])));
                          }}
                          className="inline-flex h-9 items-center rounded-[12px] border border-viao-line bg-white px-3 text-sm font-semibold text-viao-text transition hover:border-viao-accent/40"
                        >
                          <span className="mr-2">✏️</span>
                          Editar
                        </button>
                        <button
                          onClick={() => deleteAdminCatalogItem(activeAdminResource, item.id).catch((err) => setError(err instanceof Error ? err.message : "Erro ao apagar catálogo"))}
                          disabled={!canManage}
                          className="inline-flex h-9 items-center rounded-[12px] bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="mr-2">🗑️</span>
                          Apagar
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}

                {!loading && (activeResource?.items || []).length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-viao-line bg-viao-panelSoft px-4 py-6 text-center text-sm text-viao-muted">
                    {activeAdminResource === "technicians" ? "Nenhum membro elegível encontrado na Equipa do portal." : "Sem registos neste catálogo."}
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        </div>
      </div>
    </main>
  );
}

class HelpdeskAdminErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen px-4 py-8 text-viao-text sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-2xl rounded-[22px] border border-red-200 bg-red-50 p-6 text-red-800 shadow-viao">
            <div className="text-xs font-semibold uppercase tracking-[0.12em]">Administração do helpdesk</div>
            <h1 className="mt-2 text-2xl font-semibold">A página de administração falhou ao carregar</h1>
            <p className="mt-2 text-sm leading-6">Voltámos a esconder o erro bruto do React para evitar a quebra do iframe.</p>
            <pre className="mt-4 overflow-auto rounded-2xl bg-white p-4 text-xs text-red-900">
              {this.state.error?.stack || this.state.error?.message || "Erro desconhecido"}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/module/helpdesk/" className="rounded-[12px] bg-red-700 px-4 py-2 text-sm font-semibold text-white">Ver interface</a>
              <button onClick={() => window.location.reload()} className="rounded-[12px] border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800">Recarregar</button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default function HelpdeskAdminPage() {
  return (
    <HelpdeskAdminErrorBoundary>
      <HelpdeskAdminPageContent />
    </HelpdeskAdminErrorBoundary>
  );
}
