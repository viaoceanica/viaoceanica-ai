"use client";

import { useEffect, useState } from "react";
import { getApiBase, AdminCatalogResource, cardClass, fieldClass } from "../lib";

export default function HelpdeskAdminPage() {
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState("");
  const [adminCatalog, setAdminCatalog] = useState<Record<string, AdminCatalogResource>>({});
  const [activeAdminResource, setActiveAdminResource] = useState("clients");
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState<Record<string, string>>({});
  const tenantReady = tenantId.trim().length > 0;

  useEffect(() => {
    const handleContextMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.type !== "viao-context") return;
      if (payload.tenantId) setTenantId(String(payload.tenantId));
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
      if (window.parent === window) {
        try {
          const response = await fetch("/api/auth/me", { credentials: "include" });
          const payload = await response.json();
          const companyId = payload?.user?.companyId || payload?.data?.companyId || payload?.companyId;
          if (companyId) {
            setTenantId(String(companyId));
            return;
          }
        } catch {
          // ignore
        }
        setTenantId((prev) => prev || "demo");
      }
    }, 800);

    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(standaloneFallback);
    };
  }, []);

  async function loadCatalogs(activeTenantId: string) {
    const tenantHeaders = { "x-tenant-id": activeTenantId };
    const catalogRes = await fetch(`${getApiBase()}/admin/catalog`, { headers: tenantHeaders });
    const catalogJson = (await catalogRes.json()) as { success: boolean; data: Record<string, AdminCatalogResource> };

    if (!catalogRes.ok || !catalogJson.data) {
      throw new Error("Falha ao carregar catálogos administrativos");
    }

    const resourceEntries = await Promise.all(
      Object.keys(catalogJson.data).map(async (resourceKey) => {
        const response = await fetch(`${getApiBase()}/admin/catalog/${resourceKey}`, { headers: tenantHeaders });
        const payload = await response.json();
        return [resourceKey, { ...catalogJson.data[resourceKey], items: payload?.data?.items || [] }] as const;
      })
    );

    const nextCatalog = Object.fromEntries(resourceEntries);
    setAdminCatalog(nextCatalog);
    const defaultResource = Object.keys(nextCatalog)[0] || "clients";
    setActiveAdminResource((prev) => (nextCatalog[prev] ? prev : defaultResource));
  }

  function resetAdminForm(resourceKey = activeAdminResource, nextCatalog = adminCatalog) {
    const resource = nextCatalog[resourceKey];
    if (!resource) return;
    const values = Object.fromEntries(resource.fields.map((field) => [field.key, ""]));
    setEditingAdminId(null);
    setAdminForm(values);
  }

  async function submitAdminCatalog() {
    if (!tenantReady) return;
    const resource = adminCatalog[activeAdminResource];
    if (!resource) return;
    const response = await fetch(`${getApiBase()}/admin/catalog/${activeAdminResource}${editingAdminId ? `/${editingAdminId}` : ""}`, {
      method: editingAdminId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ values: adminForm }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || "Falha ao guardar registo administrativo");
    await loadCatalogs(tenantId);
    resetAdminForm(activeAdminResource);
  }

  async function deleteAdminCatalogItem(resourceKey: string, itemId: string) {
    if (!tenantReady) return;
    const response = await fetch(`${getApiBase()}/admin/catalog/${resourceKey}/${itemId}`, {
      method: "DELETE",
      headers: { "x-tenant-id": tenantId },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || "Falha ao apagar registo administrativo");
    await loadCatalogs(tenantId);
    if (editingAdminId === itemId) resetAdminForm(resourceKey);
  }

  useEffect(() => {
    if (!tenantReady) return;
    loadCatalogs(tenantId).catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar administração"));
  }, [tenantId, tenantReady]);

  useEffect(() => {
    if (adminCatalog[activeAdminResource]) {
      resetAdminForm(activeAdminResource, adminCatalog);
    }
  }, [activeAdminResource, adminCatalog]);

  return (
    <main className="mx-auto w-full max-w-7xl bg-viao-bg px-4 py-5 text-viao-text sm:px-6 lg:px-8">
      <section className={`${cardClass} mb-4`}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Administração</div>
          <h1 className="mt-1 text-2xl font-semibold text-viao-text">Administração do Helpdesk</h1>
          <p className="mt-2 text-sm leading-6 text-viao-muted">Gerir clientes, SLAs, técnicos, urgências e estados dentro do módulo Helpdesk.</p>
        </div>
      </section>

      {error ? <div className="mb-3 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <article className={cardClass}>
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Catálogos</div>
            <h2 className="mt-1 text-base font-semibold text-viao-text">Configuração</h2>
          </div>
          <div className="grid gap-2">
            {Object.entries(adminCatalog).map(([resourceKey, resource]) => (
              <button
                key={resourceKey}
                onClick={() => setActiveAdminResource(resourceKey)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${activeAdminResource === resourceKey ? "border-viao-accent bg-viao-accentLight text-viao-accent2" : "border-viao-line bg-white text-viao-text hover:border-viao-accent/40"}`}
              >
                {resource.label}
              </button>
            ))}
          </div>

          {Object.keys(adminCatalog).length > 0 && adminCatalog[activeAdminResource] ? (
            <div className="mt-4 space-y-3 rounded-lg border border-viao-line bg-viao-panelSoft p-3">
              <div className="text-sm font-semibold text-viao-text">{adminCatalog[activeAdminResource].label}</div>
              {adminCatalog[activeAdminResource].fields.map((field) => (
                <input
                  key={field.key}
                  className={fieldClass}
                  placeholder={field.label}
                  value={adminForm[field.key] || ""}
                  onChange={(e) => setAdminForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => submitAdminCatalog().catch((err) => setError(err instanceof Error ? err.message : "Erro ao guardar catálogo"))}
                  className="h-10 rounded-[8px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2"
                >
                  {editingAdminId ? "Guardar" : "Criar"}
                </button>
                <button
                  onClick={() => resetAdminForm(activeAdminResource)}
                  className="h-10 rounded-[8px] border border-viao-line bg-white px-4 text-sm font-semibold text-viao-text transition hover:border-viao-accent/40"
                >
                  Limpar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-viao-line bg-viao-panelSoft p-4 text-sm text-viao-muted">
              Administração disponível após carregar os catálogos do tenant.
            </div>
          )}
        </article>

        <article className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">CRUD</div>
              <h2 className="mt-1 text-base font-semibold text-viao-text">{adminCatalog[activeAdminResource]?.label || "Catálogo"}</h2>
            </div>
            <div className="rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1.5 text-xs text-viao-accent2">
              {adminCatalog[activeAdminResource]?.items?.length || 0}
            </div>
          </div>
          <div className="space-y-3">
            {(adminCatalog[activeAdminResource]?.items || []).map((item) => (
              <div key={item.id} className="rounded-lg border border-viao-line bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {adminCatalog[activeAdminResource].fields.map((field) => (
                    <div key={field.key}>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">{field.label}</div>
                      <div className="text-sm text-viao-text whitespace-pre-line">{item[field.key] || "-"}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setEditingAdminId(item.id);
                      setAdminForm(Object.fromEntries(adminCatalog[activeAdminResource].fields.map((field) => [field.key, item[field.key] || ""])));
                    }}
                    className="h-9 rounded-[8px] border border-viao-line bg-white px-3 text-sm font-semibold text-viao-text transition hover:border-viao-accent/40"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => deleteAdminCatalogItem(activeAdminResource, item.id).catch((err) => setError(err instanceof Error ? err.message : "Erro ao apagar catálogo"))}
                    className="h-9 rounded-[8px] bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Apagar
                  </button>
                </div>
              </div>
            ))}
            {(adminCatalog[activeAdminResource]?.items || []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-viao-line bg-viao-panelSoft px-4 py-6 text-center text-sm text-viao-muted">
                Sem registos neste catálogo.
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}
