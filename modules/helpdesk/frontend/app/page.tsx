"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Ticket = {
  id: string;
  tenant_id: string;
  requester_name: string;
  requester_email: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category?: string | null;
  assignee_name?: string | null;
};

type Conversation = {
  id: string;
  ticket_id: string;
  tenant_id: string;
  kind: string;
  author_name: string;
  author_email?: string | null;
  body: string;
  visibility: string;
  created_at?: string | null;
};

type TicketDetail = Ticket & {
  conversations?: Conversation[];
};

type TicketStatusResponse = {
  success: boolean;
  data: {
    module: string;
    tenant_id: string;
    message: string;
  };
};

type AdminSummaryResponse = {
  success: boolean;
  data: {
    summary?: Record<string, number>;
  };
};

const API_BASE = "/module/helpdesk/api-proxy";

const emptyForm = {
  requester_name: "",
  requester_email: "",
  subject: "",
  description: "",
  priority: "medium",
  category: "general",
};

const cardClass = "rounded-xl border border-viao-line bg-white p-5 shadow-viao";
const mutedCardClass = "rounded-xl border border-viao-line bg-viao-panelSoft p-4 shadow-viao";
const fieldClass = "h-10 w-full rounded-[8px] border border-viao-line bg-white px-3.5 text-sm text-viao-text outline-none transition focus:border-viao-accent/70 focus:ring-4 focus:ring-viao-accent/10 placeholder:text-slate-400";

export default function Home() {
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState<TicketStatusResponse | null>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummaryResponse | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [replyBody, setReplyBody] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPostingReply, setIsPostingReply] = useState(false);
  const [isPostingNote, setIsPostingNote] = useState(false);
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
      }
    }, 800);

    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(standaloneFallback);
    };
  }, []);

  async function loadData(activeTenantId: string) {
    const tenantHeaders = { "x-tenant-id": activeTenantId };
    const [statusRes, ticketsRes, adminRes] = await Promise.all([
      fetch(`${API_BASE}/api/status`, { headers: tenantHeaders }),
      fetch(`${API_BASE}/api/tickets`, { headers: tenantHeaders }),
      fetch(`${API_BASE}/api/tenants/${activeTenantId}/admin/summary`, { headers: tenantHeaders }),
    ]);

    const statusJson = (await statusRes.json()) as TicketStatusResponse;
    const ticketsJson = (await ticketsRes.json()) as { success: boolean; data: Ticket[] };
    const adminJson = (await adminRes.json()) as AdminSummaryResponse;

    setStatus(statusJson);
    setTickets(Array.isArray(ticketsJson.data) ? ticketsJson.data : []);
    setAdminSummary(adminRes.ok ? adminJson : null);
  }

  async function loadTicketDetail(ticketId: string, activeTenantId: string) {
    const response = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
      headers: { "x-tenant-id": activeTenantId },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || "Falha ao carregar ticket");
    setSelectedTicket(payload.data as TicketDetail);
  }

  useEffect(() => {
    if (!tenantReady) return;
    loadData(tenantId).catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar helpdesk"));
  }, [tenantId, tenantReady]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tenantReady) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error("Falha ao criar ticket");
      const created = await response.json();
      setForm(emptyForm);
      await loadData(tenantId);
      await loadTicketDetail(created.data.id, tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar ticket");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function postConversation(kind: "reply" | "note") {
    if (!tenantReady || !selectedTicket) return;
    const body = kind === "reply" ? replyBody.trim() : noteBody.trim();
    if (!body) return;
    if (kind === "reply") setIsPostingReply(true);
    else setIsPostingNote(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/tickets/${selectedTicket.id}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({
          kind,
          author_name: kind === "reply" ? selectedTicket.requester_name : "Equipa Helpdesk",
          author_email: kind === "reply" ? selectedTicket.requester_email : null,
          body,
          visibility: kind === "reply" ? "public" : "internal",
        }),
      });
      if (!response.ok) throw new Error(`Falha ao guardar ${kind}`);
      if (kind === "reply") setReplyBody("");
      else setNoteBody("");
      await loadData(tenantId);
      await loadTicketDetail(selectedTicket.id, tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar interação");
    } finally {
      if (kind === "reply") setIsPostingReply(false);
      else setIsPostingNote(false);
    }
  }

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesSearch = !q || [ticket.subject, ticket.description, ticket.requester_name, ticket.requester_email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [tickets, search, statusFilter, priorityFilter]);

  const urgentAttention = filteredTickets.filter((ticket) => ["open", "in_progress"].includes(ticket.status) || ticket.priority === "urgent");
  const processedTickets = filteredTickets.filter((ticket) => !urgentAttention.find((item) => item.id === ticket.id));

  return (
    <main className="mx-auto w-full max-w-7xl bg-viao-bg px-4 py-5 text-viao-text sm:px-6 lg:px-8">
      <section id="admin" className={`${cardClass} mb-4`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Módulo</div>
            <h1 className="mt-1 text-2xl font-semibold text-viao-text">Helpdesk</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-viao-muted">
              Sistema de suporte para clientes e empresas, com intake, triagem, conversação e resolução no mesmo fluxo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1.5 text-xs text-viao-muted">Tenant {tenantReady ? tenantId : "..."}</span>
            <span className="rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1.5 text-xs text-viao-accent2">
              {status?.data.message ?? "A carregar"}
            </span>
          </div>
        </div>
      </section>

      {error ? <div className="mb-3 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="mb-3 grid gap-3 xl:grid-cols-[1.1fr_1fr]">
        <article className={cardClass}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Resumo operacional</div>
              <h2 className="mt-1 text-lg font-semibold text-viao-text">Indicadores</h2>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(adminSummary?.data.summary ?? {}).map(([key, value]) => (
              <div key={key} className={`${mutedCardClass} p-3.5`}>
                <div className="text-lg font-semibold text-viao-text">{value}</div>
                <div className="mt-1 text-xs text-viao-muted">{key}</div>
              </div>
            ))}
          </div>
        </article>

        <article className={cardClass}>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Filtros</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-1 xl:grid-cols-[1.2fr_1fr_1fr]">
            <input className={fieldClass} placeholder="Pesquisar tickets" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={fieldClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos os estados</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="waiting_customer">Waiting customer</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <select className={fieldClass} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="all">Todas as prioridades</option>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
        <article className={`${cardClass} xl:sticky xl:top-4`}>
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Novo pedido</div>
            <h2 className="mt-1 text-base font-semibold text-viao-text">Novo ticket</h2>
          </div>

          <form onSubmit={onSubmit} className="grid gap-3">
            <input className={fieldClass} placeholder="Nome do cliente" value={form.requester_name} onChange={(e) => setForm({ ...form, requester_name: e.target.value })} required />
            <input className={fieldClass} placeholder="Email do cliente" type="email" value={form.requester_email} onChange={(e) => setForm({ ...form, requester_email: e.target.value })} required />
            <input className={fieldClass} placeholder="Assunto" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <div className="grid gap-3 sm:grid-cols-2">
              <select className={fieldClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
              <input className={fieldClass} placeholder="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <textarea className={`${fieldClass} min-h-[140px] resize-y py-3`} placeholder="Descreva o problema" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            <button type="submit" disabled={isSubmitting} className="h-10 rounded-[8px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:cursor-wait disabled:opacity-70">
              {isSubmitting ? "A criar..." : "Criar ticket"}
            </button>
          </form>
        </article>

        <article className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Fila de suporte</div>
              <h2 className="mt-1 text-base font-semibold text-viao-text">Tickets</h2>
            </div>
            <div className="rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1.5 text-xs text-viao-accent2">{filteredTickets.length}</div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-3">
              <section className={mutedCardClass}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-viao-text">Precisa de atenção</h3>
                  <span className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs text-viao-muted">{urgentAttention.length}</span>
                </div>
                <div className="mt-4 grid gap-3">
                  {urgentAttention.length === 0 ? <div className="rounded-xl border border-dashed border-viao-line bg-white px-4 py-5 text-center text-sm text-viao-muted">Nenhum ticket crítico nesta vista.</div> : urgentAttention.map(renderTicket)}
                </div>
              </section>

              <section className={mutedCardClass}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-viao-text">Processados</h3>
                  <span className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs text-viao-muted">{processedTickets.length}</span>
                </div>
                <div className="mt-4 grid gap-3">
                  {processedTickets.length === 0 ? <div className="rounded-xl border border-dashed border-viao-line bg-white px-4 py-5 text-center text-sm text-viao-muted">Nenhum ticket processado nesta vista.</div> : processedTickets.map(renderTicket)}
                </div>
              </section>
            </div>

            <aside className={mutedCardClass}>
              {!selectedTicket ? (
                <div className="rounded-xl border border-dashed border-viao-line bg-white px-4 py-8 text-center text-sm text-viao-muted">
                  Selecione um ticket para ver o detalhe, timeline, replies e notas internas.
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Detalhe</div>
                    <h3 className="mt-1 text-base font-semibold text-viao-text">{selectedTicket.subject}</h3>
                    <p className="mt-2 text-sm leading-6 text-viao-muted">{selectedTicket.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>{selectedTicket.requester_name}</span>
                      <span>{selectedTicket.requester_email}</span>
                      <span>{selectedTicket.category || "sem categoria"}</span>
                      <span>{selectedTicket.assignee_name || "sem responsável"}</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Timeline</div>
                    <div className="space-y-2">
                      {(selectedTicket.conversations || []).map((item) => (
                        <div key={item.id} className="rounded-lg border border-viao-line bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-viao-text">{item.author_name}</div>
                            <div className="flex gap-2">
                              <span className="rounded-full border border-viao-line bg-viao-panelSoft px-2.5 py-1 text-[11px] text-viao-muted">{item.kind}</span>
                              <span className="rounded-full border border-viao-line bg-viao-panelSoft px-2.5 py-1 text-[11px] text-viao-muted">{item.visibility}</span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-viao-muted">{item.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-viao-line bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Reply público</div>
                    <textarea className={`${fieldClass} min-h-[90px] resize-y py-3`} placeholder="Responder ao cliente" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
                    <button onClick={() => postConversation("reply")} disabled={isPostingReply} className="h-10 rounded-[8px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:cursor-wait disabled:opacity-70">
                      {isPostingReply ? "A guardar..." : "Adicionar reply"}
                    </button>
                  </div>

                  <div className="space-y-3 rounded-lg border border-viao-line bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Nota interna</div>
                    <textarea className={`${fieldClass} min-h-[90px] resize-y py-3`} placeholder="Registar nota interna" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                    <button onClick={() => postConversation("note")} disabled={isPostingNote} className="h-10 rounded-[8px] bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70">
                      {isPostingNote ? "A guardar..." : "Adicionar nota"}
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </article>
      </section>
    </main>
  );

  function renderTicket(ticket: Ticket) {
    return (
      <button key={ticket.id} onClick={() => loadTicketDetail(ticket.id, tenantId)} className="w-full rounded-lg border border-viao-line bg-white p-3 text-left transition hover:border-viao-accent/40 hover:bg-viao-accentLight/30">
        <div className="flex items-start justify-between gap-3">
          <strong className="text-[13px] font-semibold text-viao-text">{ticket.subject}</strong>
          <div className="flex flex-wrap gap-2">
            <span className={priorityPill(ticket.priority)}>{ticket.priority}</span>
            <span className="rounded-full border border-viao-accent/15 bg-viao-accentLight px-2.5 py-1 text-[11px] text-viao-accent2">{ticket.status}</span>
          </div>
        </div>
        <p className="mt-2 text-sm leading-6 text-viao-muted">{ticket.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{ticket.requester_name}</span>
          <span>{ticket.requester_email}</span>
          <span>{ticket.category || "sem categoria"}</span>
          <span>{ticket.assignee_name || "sem responsável"}</span>
        </div>
      </button>
    );
  }
}

function priorityPill(priority: string): string {
  const base = "rounded-full border px-3 py-1 text-[11px]";
  switch (priority) {
    case "urgent":
      return `${base} border-red-200 bg-red-50 text-red-700`;
    case "high":
      return `${base} border-amber-200 bg-amber-50 text-amber-700`;
    case "medium":
      return `${base} border-viao-accent/20 bg-viao-accentLight text-viao-accent2`;
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
  }
}
