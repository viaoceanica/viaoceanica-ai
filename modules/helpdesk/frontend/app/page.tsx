"use client";

import { useEffect, useMemo, useState } from "react";

type StatusResponse = {
  success: boolean;
  data: {
    module: string;
    tenant_id: string;
    user_id?: string;
    company_role?: string;
    message: string;
  };
};

type AdminSummaryResponse = {
  success: boolean;
  data: {
    module: string;
    tenant_id: string;
    admin_access: boolean;
    company_role: string;
    platform_roles: string;
    message: string;
  };
};

const API_BASE = "/module/helpdesk/api-proxy";

export default function Home() {
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummaryResponse | null>(null);
  const [error, setError] = useState("");
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

    const standaloneFallback = window.setTimeout(() => {
      if (window.parent === window) {
        setTenantId((prev) => prev || "demo");
      } else if (!tenantId) {
        try {
          window.parent.postMessage({ type: "viao-context-request" }, "*");
        } catch {
          // ignore
        }
      }
    }, 800);

    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(standaloneFallback);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantReady) return;

    let cancelled = false;

    async function load() {
      setError("");
      try {
        const statusRes = await fetch(`${API_BASE}/api/status`, {
          headers: {
            "x-tenant-id": tenantId,
          },
        });
        const statusJson = (await statusRes.json()) as StatusResponse;
        if (!cancelled) setStatus(statusJson);

        const adminRes = await fetch(`${API_BASE}/api/tenants/${tenantId}/admin/summary`, {
          headers: {
            "x-tenant-id": tenantId,
          },
        });
        const adminJson = (await adminRes.json()) as AdminSummaryResponse;
        if (!cancelled && adminRes.ok) {
          setAdminSummary(adminJson);
        } else if (!cancelled) {
          setAdminSummary(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar módulo");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, tenantReady]);

  const summaryLines = useMemo(() => {
    if (!status?.data) return [];
    return [
      ["module", status.data.module],
      ["tenant", status.data.tenant_id],
      ["user", status.data.user_id ?? "—"],
      ["role", status.data.company_role ?? "—"],
    ];
  }, [status]);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: 8 }}>Helpdesk</h1>
          <p style={{ margin: 0, color: "#555" }}>Módulo integrado na plataforma Via Oceânica AI</p>
        </div>
        <div style={{ fontSize: 14, padding: "0.5rem 0.75rem", background: "#f5f5f5", borderRadius: 8 }}>
          Tenant: <strong>{tenantReady ? tenantId : "a aguardar contexto"}</strong>
        </div>
      </div>

      {!tenantReady && (
        <div style={{ marginTop: 24, padding: 16, background: "#fff7e6", border: "1px solid #ffe58f", borderRadius: 8 }}>
          A aguardar contexto do dashboard ou fallback local.
        </div>
      )}

      {error && (
        <div style={{ marginTop: 24, padding: 16, background: "#fff1f0", border: "1px solid #ffa39e", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <article style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Estado do módulo</h2>
          {status ? (
            <>
              <p style={{ color: "#555" }}>{status.data.message}</p>
              <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                {summaryLines.map(([label, value]) => (
                  <li key={label}>
                    <strong>{label}:</strong> {value}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ color: "#777" }}>A carregar...</p>
          )}
        </article>

        <article style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Administração</h2>
          {adminSummary?.success ? (
            <>
              <p style={{ color: "#555" }}>{adminSummary.data.message}</p>
              <p style={{ marginBottom: 0 }}>
                <strong>Papel:</strong> {adminSummary.data.company_role || "—"}
              </p>
            </>
          ) : (
            <p style={{ color: "#777", marginBottom: 0 }}>
              Sem acesso admin no contexto atual, ou área ainda não expandida.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
