"use client";

import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AdminCatalogItem,
  AdminSummaryResponse,
  Ticket,
  TicketDetail,
  TicketStatusResponse,
  PlatformMember,
  cardClass,
  emptyForm,
  fieldClass,
  getApiBase,
  getPlatformApiBase,
  mutedCardClass,
  priorityPill,
  rolePill,
  statusPill,
} from "./lib";

function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatLongDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDuration(minutes?: number | null) {
  if (!minutes || Number.isNaN(minutes)) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function dueAtFromSlaMinutes(minutes?: number | null) {
  if (!minutes || Number.isNaN(minutes) || minutes <= 0) return "";
  const date = new Date(Date.now() + minutes * 60_000);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function defaultSlaMinutes(priority: string) {
  switch (priority) {
    case "urgent":
      return 120;
    case "high":
      return 480;
    case "low":
      return 2880;
    default:
      return 1440;
  }
}

type AttachmentDraft = {
  filename: string;
  contentType: string;
  contentB64: string;
  size: number;
};

type TicketPanelTab = "overview" | "reply" | "history";

type ClientCatalogItem = AdminCatalogItem & {
  name?: string;
  company_name?: string;
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
};

function buildClientOptionLabel(client: ClientCatalogItem) {
  const parts = [client.name, client.company_name, client.code]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : client.id;
}

function buildClientSearchHaystack(client: ClientCatalogItem) {
  return [client.name, client.company_name, client.code, client.email, client.phone, client.address]
    .map((value) => (value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

type CategoryCatalogItem = AdminCatalogItem & {
  name?: string;
  code?: string;
  description?: string;
  team?: string;
  active?: string;
};

type SlaCatalogItem = AdminCatalogItem & {
  name?: string;
  responseTime?: string;
  resolutionTime?: string;
  active?: string;
};

type SlaPolicyCatalogItem = AdminCatalogItem & {
  name?: string;
  priority?: string;
  responseTime?: string;
  resolutionTime?: string;
  active?: string;
};

function buildCategoryOptionLabel(category: CategoryCatalogItem) {
  const parts = [category.name, category.code]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : category.id;
}

function buildCategorySearchHaystack(category: CategoryCatalogItem) {
  return [category.name, category.code, category.description, category.team]
    .map((value) => (value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function isCatalogEntryActive(value?: string) {
  return !value || ["1", "true", "yes", "on", "active"].includes(value.trim().toLowerCase());
}

function parseDurationMinutes(value?: string | null) {
  const input = (value || "").trim().toLowerCase();
  if (!input) return null;
  const match = input.match(/^(\d+(?:[.,]\d+)?)\s*(m|min|mins|minute|minutes|minuto|minutos|h|hr|hrs|hour|hours|hora|horas|d|day|days|dia|dias)?$/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] || "m").toLowerCase();
  if (["d", "day", "days", "dia", "dias"].includes(unit)) return Math.round(amount * 1440);
  if (["h", "hr", "hrs", "hour", "hours", "hora", "horas"].includes(unit)) return Math.round(amount * 60);
  return Math.round(amount);
}

function buildSlaOptionLabel(item: SlaCatalogItem) {
  const name = (item.name || "SLA").trim();
  const meta = [
    item.responseTime ? `resposta ${item.responseTime}` : "",
    item.resolutionTime ? `resolução ${item.resolutionTime}` : "",
  ].filter(Boolean);
  return meta.length > 0 ? `${name} · ${meta.join(" · ")}` : name;
}

const cannedReplies = [
  {
    label: "Acolher e triagem",
    body: "Olá, obrigado por abrir o ticket. Já recebemos o pedido e estamos a analisar o contexto para encaminhar a melhor ação.",
  },
  {
    label: "Pedir detalhes",
    body: "Olá, para avançarmos, pode enviar mais detalhes, capturas de ecrã ou o passo exato que leva ao problema?",
  },
  {
    label: "Resolvido",
    body: "O problema foi resolvido do nosso lado. Se notar algo fora do normal, responda a este ticket e continuamos a acompanhar.",
  },
  {
    label: "A aguardar resposta",
    body: "Estamos a aguardar uma resposta sua para continuar. Assim que tiver a informação pedida, retomamos o ticket.",
  },
];

function ActionIconButton({
  title,
  onClick,
  disabled,
  children,
  accent = false,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        accent
          ? "border-viao-accent bg-viao-accent text-white hover:bg-viao-accent2"
          : danger
            ? "border-viao-line bg-white text-viao-text hover:border-red-200 hover:text-red-700"
          : "border-viao-line bg-white text-viao-text hover:border-viao-accent/40"
      }`}
    >
      <span className="sr-only">{title}</span>
      {children}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function fileToAttachmentDraft(file: File): Promise<AttachmentDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const contentB64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentB64,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`Falha ao ler o ficheiro ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [platformRoles, setPlatformRoles] = useState("");
  const [status, setStatus] = useState<TicketStatusResponse | null>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummaryResponse | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [ticketPanelTab, setTicketPanelTab] = useState<TicketPanelTab>("overview");
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [clientCatalog, setClientCatalog] = useState<ClientCatalogItem[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [categoryCatalog, setCategoryCatalog] = useState<CategoryCatalogItem[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [slaCatalog, setSlaCatalog] = useState<SlaCatalogItem[]>([]);
  const [slaPolicyCatalog, setSlaPolicyCatalog] = useState<SlaPolicyCatalogItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [replyBody, setReplyBody] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<AttachmentDraft[]>([]);
  const [quickReplyMenuTicketId, setQuickReplyMenuTicketId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMutatingTicket, setIsMutatingTicket] = useState(false);
  const [isPostingReply, setIsPostingReply] = useState(false);
  const [isPostingNote, setIsPostingNote] = useState(false);

  const tenantReady = tenantId.trim().length > 0;
  const effectiveCompanyRole = (status?.data.company_role || companyRole || "member").trim().toLowerCase();
  const platformRoleSet = new Set(platformRoles.split(",").map((role) => role.trim().toLowerCase()).filter(Boolean));
  const canManageTickets = ["owner", "admin"].includes(effectiveCompanyRole) || platformRoleSet.has("admin");
  const canEditTickets = ["owner", "admin", "member", "lead"].includes(effectiveCompanyRole) || platformRoleSet.has("admin");

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

    const standaloneFallback = window.setTimeout(() => {
      if (window.parent === window) {
        setTenantId((prev) => prev || "demo");
      }
    }, 700);

    return () => {
      window.removeEventListener("message", handleContextMessage);
      window.clearTimeout(standaloneFallback);
    };
  }, []);

  async function loadMembers() {
    try {
      const response = await fetch(`${getPlatformApiBase()}/members`, { credentials: "include" });
      const payload = await response.json();
      setMembers(Array.isArray(payload?.data) ? payload.data : []);
    } catch {
      setMembers([]);
    }
  }

  function buildModuleHeaders(activeTenantId: string) {
    return {
      "x-tenant-id": activeTenantId,
      "x-viao-tenant-id": activeTenantId,
      ...(userId ? { "x-viao-user-id": userId } : {}),
      ...(companyRole ? { "x-viao-company-role": companyRole } : { "x-viao-company-role": "member" }),
      ...(platformRoles ? { "x-viao-platform-roles": platformRoles } : { "x-viao-platform-roles": "member" }),
    };
  }

  async function loadWorkspace(activeTenantId: string) {
    const tenantHeaders = buildModuleHeaders(activeTenantId);
    const [statusRes, ticketsRes, adminRes] = await Promise.all([
      fetch(`${getApiBase()}/api/status`, { headers: tenantHeaders }),
      fetch(`${getApiBase()}/api/tickets`, { headers: tenantHeaders }),
      fetch(`${getApiBase()}/api/tenants/${activeTenantId}/admin/summary`, { headers: tenantHeaders }),
    ]);

    const statusJson = (await statusRes.json()) as TicketStatusResponse;
    const ticketsJson = (await ticketsRes.json()) as { success: boolean; data: Ticket[] };
    const adminJson = (await adminRes.json()) as AdminSummaryResponse;

    setStatus(statusJson);
    setTickets(Array.isArray(ticketsJson.data) ? ticketsJson.data : []);
    setAdminSummary(adminRes.ok ? adminJson : null);

    try {
      const clientsRes = await fetch(`${getApiBase()}/api/admin/catalog/clients`, { headers: tenantHeaders });
      const clientsJson = (await clientsRes.json()) as { data?: { items?: ClientCatalogItem[] } };
      const nextClients = Array.isArray(clientsJson?.data?.items) ? clientsJson.data.items : [];
      setClientCatalog(
        [...nextClients].sort((a, b) =>
          buildClientOptionLabel(a).localeCompare(buildClientOptionLabel(b), "pt-PT", { sensitivity: "base" })
        )
      );
    } catch {
      setClientCatalog([]);
    }

    try {
      const categoriesRes = await fetch(`${getApiBase()}/api/admin/catalog/categories`, { headers: tenantHeaders });
      const categoriesJson = (await categoriesRes.json()) as { data?: { items?: CategoryCatalogItem[] } };
      const nextCategories = Array.isArray(categoriesJson?.data?.items) ? categoriesJson.data.items : [];
      setCategoryCatalog(
        nextCategories
          .filter((category) => isCatalogEntryActive(category.active))
          .sort((a, b) => buildCategoryOptionLabel(a).localeCompare(buildCategoryOptionLabel(b), "pt-PT", { sensitivity: "base" }))
      );
    } catch {
      setCategoryCatalog([]);
    }

    try {
      const slasRes = await fetch(`${getApiBase()}/api/admin/catalog/slas`, { headers: tenantHeaders });
      const slasJson = (await slasRes.json()) as { data?: { items?: SlaCatalogItem[] } };
      const nextSlas = Array.isArray(slasJson?.data?.items) ? slasJson.data.items : [];
      setSlaCatalog(
        nextSlas
          .filter((sla) => isCatalogEntryActive(sla.active) && parseDurationMinutes(sla.resolutionTime) !== null)
          .sort((a, b) => (parseDurationMinutes(a.resolutionTime) || 0) - (parseDurationMinutes(b.resolutionTime) || 0))
      );
    } catch {
      setSlaCatalog([]);
    }

    try {
      const slaPoliciesRes = await fetch(`${getApiBase()}/api/admin/catalog/sla_policies`, { headers: tenantHeaders });
      const slaPoliciesJson = (await slaPoliciesRes.json()) as { data?: { items?: SlaPolicyCatalogItem[] } };
      const nextPolicies = Array.isArray(slaPoliciesJson?.data?.items) ? slaPoliciesJson.data.items : [];
      setSlaPolicyCatalog(nextPolicies.filter((policy) => isCatalogEntryActive(policy.active) && parseDurationMinutes(policy.resolutionTime) !== null));
    } catch {
      setSlaPolicyCatalog([]);
    }

    await loadMembers();

  }

  async function loadTicketDetail(ticketId: string, activeTenantId: string) {
    const response = await fetch(`${getApiBase()}/api/tickets/${ticketId}`, {
      headers: buildModuleHeaders(activeTenantId),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || "Falha ao carregar ticket");
    setSelectedTicket(payload.data as TicketDetail);
  }

  useEffect(() => {
    if (!tenantReady) return;
    loadWorkspace(tenantId).catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar helpdesk"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, tenantReady]);

  useEffect(() => {
    setTagDraft((selectedTicket?.tags || []).join(", "));
  }, [selectedTicket]);

  async function reloadTicket(ticketId: string) {
    if (!tenantReady) return;
    await loadTicketDetail(ticketId, tenantId);
  }

  async function focusTicket(ticketId: string, tab: TicketPanelTab = "overview") {
    await reloadTicket(ticketId);
    setTicketPanelTab(tab);
  }

  async function openInlineEditor(ticketId: string) {
    await focusTicket(ticketId, "overview");
    setEditingTicketId(ticketId);
    window.setTimeout(() => {
      document.getElementById(`ticket-inline-${ticketId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function saveTicket(ticketId: string, updates: Record<string, unknown>) {
    if (!tenantReady) return;
    setIsMutatingTicket(true);
    setError("");
    try {
      const response = await fetch(`${getApiBase()}/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildModuleHeaders(tenantId),
        },
        body: JSON.stringify(updates),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Falha ao atualizar ticket");
      await loadWorkspace(tenantId);
      await reloadTicket(ticketId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar ticket");
    } finally {
      setIsMutatingTicket(false);
    }
  }

  async function deleteTicket(ticketId: string) {
    if (!tenantReady) return;
    const confirmed = window.confirm("Eliminar este ticket? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    setIsMutatingTicket(true);
    setError("");
    try {
      const response = await fetch(`${getApiBase()}/api/tickets/${ticketId}`, {
        method: "DELETE",
        headers: buildModuleHeaders(tenantId),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Falha ao apagar ticket");
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(null);
        setTicketPanelTab("overview");
      }
      await loadWorkspace(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao apagar ticket");
    } finally {
      setIsMutatingTicket(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tenantReady) return;
    setIsSubmitting(true);
    setError("");
    if (clientCatalog.length > 0 && !selectedClientId) {
      setError("Selecione um cliente da lista configurada no backend.");
      setIsSubmitting(false);
      return;
    }
    if (categoryCatalog.length > 0 && !selectedCategoryId) {
      setError("Selecione uma categoria da lista configurada no backend.");
      setIsSubmitting(false);
      return;
    }
    const requestBody = {
      requester_name: form.requester_name,
      requester_email: form.requester_email,
      subject: form.subject,
      description: form.description,
      priority: form.priority,
      category: form.category,
      ...(form.sla_minutes ? { sla_minutes: Number(form.sla_minutes) } : {}),
      ...(form.due_at ? { due_at: fromDatetimeLocalValue(form.due_at) } : {}),
    };
    try {
      const response = await fetch(`${getApiBase()}/api/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildModuleHeaders(tenantId),
        },
        body: JSON.stringify(requestBody),
      });
      const responsePayload = await response.json();
      if (!response.ok) throw new Error(responsePayload?.detail || "Falha ao criar ticket");
      setForm(emptyForm);
      setSelectedClientId(null);
      setClientSearch("");
      setClientPickerOpen(false);
      setSelectedCategoryId(null);
      setCategorySearch("");
      setCategoryPickerOpen(false);
      await loadWorkspace(tenantId);
      await reloadTicket(responsePayload.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar ticket");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReplyAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    try {
      const drafts = await Promise.all(files.map(fileToAttachmentDraft));
      setReplyAttachments((prev) => [...prev, ...drafts].slice(0, 5));
      event.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar anexos");
    }
  }

  function parseTagDraft() {
    return tagDraft
      .split(/[;,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  async function saveSelectedTicketTags() {
    if (!selectedTicket) return;
    await saveTicket(selectedTicket.id, { tags: parseTagDraft() });
  }

  async function saveInlineTicket() {
    if (!selectedTicket) return;
    const ticket = selectedTicket;
    await saveTicket(ticket.id, {
      status: ticket.status,
      priority: ticket.priority,
      assignee_name: ticket.assignee_name || null,
      sla_minutes: ticket.sla_minutes ?? null,
      due_at: ticket.due_at,
    });
    await saveSelectedTicketTags();
  }

  async function postConversation(
    kind: "reply" | "note",
    options?: {
      body?: string;
      ticket?: TicketDetail | null;
      attachments?: AttachmentDraft[];
      preserveDraft?: boolean;
    }
  ) {
    const targetTicket = options?.ticket ?? selectedTicket;
    if (!tenantReady || !targetTicket) return;
    const body = (options?.body ?? (kind === "reply" ? replyBody : noteBody)).trim();
    if (!body) return;

    if (kind === "reply") setIsPostingReply(true);
    else setIsPostingNote(true);
    setError("");

    try {
      const response = await fetch(`${getApiBase()}/api/tickets/${targetTicket.id}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildModuleHeaders(tenantId),
        },
        body: JSON.stringify({
          kind,
          author_name: kind === "reply" ? targetTicket.requester_name : "Equipa Helpdesk",
          author_email: kind === "reply" ? targetTicket.requester_email : null,
          body,
          visibility: kind === "reply" ? "public" : "internal",
          attachments:
            kind === "reply"
              ? (options?.attachments ?? replyAttachments).map((attachment) => ({
                  filename: attachment.filename,
                  content_type: attachment.contentType,
                  content_b64: attachment.contentB64,
                }))
              : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || `Falha ao guardar ${kind}`);
      if (!options?.preserveDraft) {
        if (kind === "reply") setReplyBody("");
        else setNoteBody("");
        if (kind === "reply") setReplyAttachments([]);
      }
      await reloadTicket(targetTicket.id);
      await loadWorkspace(tenantId);
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

  const metrics = useMemo(() => {
    const summary = adminSummary?.data?.summary ?? {};
    return {
      total: summary.total ?? filteredTickets.length,
      open: summary.open ?? filteredTickets.filter((ticket) => ticket.status === "open").length,
      inProgress: summary.in_progress ?? filteredTickets.filter((ticket) => ticket.status === "in_progress").length,
      waiting: summary.waiting_customer ?? filteredTickets.filter((ticket) => ticket.status === "waiting_customer").length,
      urgent: summary.urgent ?? filteredTickets.filter((ticket) => ticket.priority === "urgent").length,
      resolved: summary.resolved ?? filteredTickets.filter((ticket) => ticket.status === "resolved").length,
    };
  }, [adminSummary, filteredTickets]);

  const supportAgents = useMemo(
    () => [...members].sort((a, b) => Number(b.companyRole === "owner") - Number(a.companyRole === "owner") || Number(b.companyRole === "admin") - Number(a.companyRole === "admin")),
    [members]
  );

  const selectedClient = useMemo(
    () => clientCatalog.find((client) => client.id === selectedClientId) || null,
    [clientCatalog, selectedClientId]
  );

  const selectedCategory = useMemo(
    () => categoryCatalog.find((category) => category.id === selectedCategoryId) || null,
    [categoryCatalog, selectedCategoryId]
  );

  const filteredClientCatalog = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    const candidates = query ? clientCatalog.filter((client) => buildClientSearchHaystack(client).includes(query)) : clientCatalog;
    return candidates.slice(0, 8);
  }, [clientCatalog, clientSearch]);

  const filteredCategoryCatalog = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    const candidates = query ? categoryCatalog.filter((category) => buildCategorySearchHaystack(category).includes(query)) : categoryCatalog;
    return candidates.slice(0, 8);
  }, [categoryCatalog, categorySearch]);

  const slaOptions = useMemo(() => {
    const backendOptions = slaCatalog
      .map((item) => {
        const minutes = parseDurationMinutes(item.resolutionTime);
        return minutes
          ? {
              value: String(minutes),
              label: buildSlaOptionLabel(item),
            }
          : null;
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));

    return backendOptions.length > 0
      ? backendOptions
      : [
          { value: "120", label: "2 horas" },
          { value: "480", label: "8 horas" },
          { value: "1440", label: "24 horas" },
          { value: "2880", label: "48 horas" },
        ];
  }, [slaCatalog]);

  const automaticSlaMinutesByPriority = useMemo(() => {
    const mapping = new Map<string, number>();
    for (const policy of slaPolicyCatalog) {
      const priority = (policy.priority || "").trim().toLowerCase();
      const minutes = parseDurationMinutes(policy.resolutionTime);
      if (!priority || !minutes || mapping.has(priority)) continue;
      mapping.set(priority, minutes);
    }
    return mapping;
  }, [slaPolicyCatalog]);

  function resolveAutomaticSlaMinutes(priority: string) {
    return automaticSlaMinutesByPriority.get((priority || "").trim().toLowerCase()) || defaultSlaMinutes(priority);
  }

  const formSlaValueMissing = Boolean(form.sla_minutes) && !slaOptions.some((option) => option.value === form.sla_minutes);
  const selectedTicketSlaValueMissing = Boolean(selectedTicket?.sla_minutes) && !slaOptions.some((option) => option.value === String(selectedTicket?.sla_minutes || ""));

  const openTickets = useMemo(() => filteredTickets.filter((ticket) => ticket.status === "open"), [filteredTickets]);

  const selectedAssignee = selectedTicket?.assignee_name ?? "";
  const primaryTenant = supportAgents.find((member) => member.companyRole === "owner");
  const ticketLabel = (ticket: Ticket) => `#${ticket.id.slice(0, 8).toUpperCase()}`;
  const openTicketTableGridClass = "grid min-w-[1680px] grid-cols-[96px_120px_minmax(220px,1fr)_minmax(260px,1.55fr)_170px_110px_150px_130px_180px_165px_130px] gap-3";

  return (
    <main className="min-h-screen px-4 py-4 text-viao-text sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1600px]">
        <section className={`${cardClass} mb-4 overflow-hidden`}> 
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-viao-accent2">
                Helpdesk do dashboard
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-viao-text">Helpdesk</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-viao-muted">
                Fila de suporte por tenant, com equipa do dashboard como agentes e escopo isolado por empresa.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="#queue" className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-viao-text transition hover:border-viao-accent/40 hover:bg-viao-accentLight">Fila</a>
                <a href="#detail" className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-viao-text transition hover:border-viao-accent/40 hover:bg-viao-accentLight">Detalhe</a>
                <a href="#team" className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-viao-text transition hover:border-viao-accent/40 hover:bg-viao-accentLight">Equipa</a>
                <a href="#new-ticket" className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-viao-text transition hover:border-viao-accent/40 hover:bg-viao-accentLight">Novo ticket</a>
              </div>
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
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Primary Tenant</div>
                <div className="mt-1 font-medium text-viao-text">{primaryTenant?.name || "Owner do dashboard"}</div>
              </div>
              <div className="rounded-2xl border border-viao-line bg-viao-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Estado</div>
                <div className="mt-1 font-medium text-viao-text">{status?.data.message ?? "A carregar"}</div>
              </div>
            </div>
          </div>
        </section>

        {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="space-y-4">
          <section className={cardClass} id="new-ticket">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Desk</div>
                <h2 className="mt-1 text-lg font-semibold text-viao-text">Novo ticket</h2>
              </div>
              <span className="rounded-full border border-viao-accent/20 bg-viao-accentLight px-3 py-1.5 text-xs text-viao-accent2">
                {metrics.total} tickets
              </span>
            </div>

            <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Cliente</span>
                  {clientCatalog.length > 0 ? (
                    <div className="relative">
                      <input
                        className={fieldClass}
                        placeholder="Pesquisar cliente por nome, empresa, código ou email"
                        value={clientSearch}
                        onFocus={() => setClientPickerOpen(true)}
                        onBlur={() => window.setTimeout(() => setClientPickerOpen(false), 120)}
                        onChange={(e) => {
                          setClientSearch(e.target.value);
                          setSelectedClientId(null);
                          setClientPickerOpen(true);
                          setForm((current) => ({ ...current, requester_name: "", requester_email: "" }));
                        }}
                        required
                      />
                      {clientPickerOpen ? (
                        <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-[18px] border border-viao-line bg-white p-2 shadow-viao">
                          {filteredClientCatalog.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-viao-muted">Nenhum cliente encontrado.</div>
                          ) : (
                            filteredClientCatalog.map((client) => (
                              <button
                                key={client.id}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setSelectedClientId(client.id);
                                  setClientSearch(buildClientOptionLabel(client));
                                  setClientPickerOpen(false);
                                  setForm((current) => ({
                                    ...current,
                                    requester_name: (client.name || "").trim(),
                                    requester_email: (client.email || "").trim(),
                                  }));
                                }}
                                className="flex w-full flex-col items-start rounded-[14px] px-3 py-2 text-left transition hover:bg-viao-panelSoft"
                              >
                                <span className="text-sm font-semibold text-viao-text">{client.name || client.code || "Cliente"}</span>
                                <span className="text-xs text-viao-muted">
                                  {[client.company_name, client.code, client.email].map((value) => (value || "").trim()).filter(Boolean).join(" · ") || "Sem metadados adicionais"}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <input className={fieldClass} placeholder="Ex. Maria Silva" value={form.requester_name} onChange={(e) => setForm({ ...form, requester_name: e.target.value })} required />
                  )}
                  {clientCatalog.length > 0 ? (
                    <span className="text-xs text-viao-muted">
                      {selectedClient
                        ? [selectedClient.company_name, selectedClient.code, selectedClient.phone].map((value) => (value || "").trim()).filter(Boolean).join(" · ") || "Cliente selecionado do catálogo"
                        : "Escolha um cliente do catálogo configurado no backend."}
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Email do cliente</span>
                  <input className={fieldClass} placeholder="Ex. maria@empresa.pt" type="email" value={form.requester_email} onChange={(e) => setForm({ ...form, requester_email: e.target.value })} required />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Assunto</span>
                  <input className={fieldClass} placeholder="Resumo curto do problema" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Prioridade</span>
                    <select
                      className={fieldClass}
                      value={form.priority}
                      onChange={(e) =>
                        setForm((current) => {
                          const nextPriority = e.target.value;
                          const nextSlaMinutes = current.sla_minutes ? Number(current.sla_minutes) : resolveAutomaticSlaMinutes(nextPriority);
                          return {
                            ...current,
                            priority: nextPriority,
                            sla_minutes: current.sla_minutes || String(nextSlaMinutes),
                            due_at: dueAtFromSlaMinutes(nextSlaMinutes),
                          };
                        })
                      }
                    >
                      <option value="low">Baixa</option>
                      <option value="medium">Média</option>
                      <option value="high">Alta</option>
                      <option value="urgent">Urgente</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Categoria</span>
                    {categoryCatalog.length > 0 ? (
                      <div className="relative">
                        <input
                          className={fieldClass}
                          placeholder="Pesquisar categoria por nome, código ou equipa"
                          value={categorySearch}
                          onFocus={() => setCategoryPickerOpen(true)}
                          onBlur={() => window.setTimeout(() => setCategoryPickerOpen(false), 120)}
                          onChange={(e) => {
                            setCategorySearch(e.target.value);
                            setSelectedCategoryId(null);
                            setCategoryPickerOpen(true);
                            setForm((current) => ({ ...current, category: "" }));
                          }}
                          required
                        />
                        {categoryPickerOpen ? (
                          <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-[18px] border border-viao-line bg-white p-2 shadow-viao">
                            {filteredCategoryCatalog.length === 0 ? (
                              <div className="px-3 py-3 text-sm text-viao-muted">Nenhuma categoria encontrada.</div>
                            ) : (
                              filteredCategoryCatalog.map((category) => (
                                <button
                                  key={category.id}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setSelectedCategoryId(category.id);
                                    setCategorySearch(buildCategoryOptionLabel(category));
                                    setCategoryPickerOpen(false);
                                    setForm((current) => ({
                                      ...current,
                                      category: (category.name || category.code || "").trim(),
                                    }));
                                  }}
                                  className="flex w-full flex-col items-start rounded-[14px] px-3 py-2 text-left transition hover:bg-viao-panelSoft"
                                >
                                  <span className="text-sm font-semibold text-viao-text">{category.name || category.code || "Categoria"}</span>
                                  <span className="text-xs text-viao-muted">
                                    {[category.code, category.team, category.description].map((value) => (value || "").trim()).filter(Boolean).join(" · ") || "Sem metadados adicionais"}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <input className={fieldClass} placeholder="Opcional, para triagem" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                    )}
                    {categoryCatalog.length > 0 ? (
                      <span className="text-xs text-viao-muted">
                        {selectedCategory
                          ? [selectedCategory.code, selectedCategory.team, selectedCategory.description].map((value) => (value || "").trim()).filter(Boolean).join(" · ") || "Categoria selecionada do catálogo"
                          : "Escolha uma categoria do catálogo configurado no backend."}
                      </span>
                    ) : null}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">SLA</span>
                    <select
                      className={fieldClass}
                      value={form.sla_minutes}
                      onChange={(e) =>
                        setForm((current) => {
                          const nextSlaValue = e.target.value;
                          const nextSlaMinutes = nextSlaValue ? Number(nextSlaValue) : resolveAutomaticSlaMinutes(current.priority);
                          return {
                            ...current,
                            sla_minutes: nextSlaValue,
                            due_at: dueAtFromSlaMinutes(nextSlaMinutes),
                          };
                        })
                      }
                    >
                      <option value="">SLA automático</option>
                      {slaOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {formSlaValueMissing ? <option value={form.sla_minutes}>Personalizado ({formatDuration(Number(form.sla_minutes))})</option> : null}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Data limite</span>
                    <input className={fieldClass} type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
                  </label>
                </div>
              </div>

              <div className="flex h-full flex-col gap-2">
                <label className="grid flex-1 gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Descrição</span>
                  <textarea className={`${fieldClass} min-h-[172px] flex-1 resize-y py-3`} placeholder="Descreva o problema" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
                </label>
                <div className="flex items-center justify-between gap-3 rounded-[16px] border border-dashed border-viao-line bg-viao-panelSoft px-3 py-3 text-xs text-viao-muted">
                  <span>Formato horizontal, melhor para preenchimento rápido.</span>
                  <button type="submit" disabled={isSubmitting} className="h-10 rounded-[12px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:cursor-wait disabled:opacity-70">
                    {isSubmitting ? "A criar..." : "Criar ticket"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <section className={cardClass} id="team">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Desk</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">Painel rápido</h2>
                </div>
              </div>

              <div className="space-y-2 rounded-[18px] border border-viao-line bg-viao-panelSoft p-3">
                {[
                  ["#queue", "Fila"],
                  ["#detail", "Detalhe"],
                  ["#team", "Equipa"],
                ].map(([href, label]) => (
                  <a
                    key={String(href)}
                    href={String(href)}
                    className="flex items-center justify-between rounded-[14px] border border-transparent px-3 py-2 text-sm font-medium text-viao-text transition hover:border-viao-line hover:bg-white"
                  >
                    <span>{label}</span>
                    <span className="text-xs text-viao-muted">›</span>
                  </a>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  ["Abertos", metrics.open],
                  ["Em curso", metrics.inProgress],
                  ["À espera", metrics.waiting],
                  ["Urgentes", metrics.urgent],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-viao-line bg-viao-panelSoft px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">{label}</div>
                    <div className="mt-1 text-xl font-semibold text-viao-text">{value as number}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Equipa</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">Agentes do dashboard</h2>
                </div>
                <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1 text-xs text-viao-muted">{supportAgents.length}</span>
              </div>
              <div className="mt-4 space-y-2">
                {supportAgents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-viao-line bg-viao-panelSoft px-4 py-5 text-sm text-viao-muted">
                    Nenhum membro encontrado para este tenant.
                  </div>
                ) : (
                  supportAgents.map((member) => (
                    <div key={member.id} className="rounded-2xl border border-viao-line bg-viao-panelSoft px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-viao-text">{member.name || member.email || `Membro ${member.id}`}</div>
                          <div className="mt-1 text-xs text-viao-muted">{member.email || "Sem email"}</div>
                        </div>
                        <span className={rolePill(member.companyRole)}>{member.companyRole || "member"}</span>
                      </div>
                      <div className="mt-2 text-[11px] uppercase tracking-[0.08em] text-viao-muted">
                        {member.companyRole === "owner" ? "Primary Tenant" : member.companyRole === "admin" ? "Support lead" : "Support agent"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
            </aside>

          <section className="space-y-4">
            <section className={cardClass} id="queue">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Fila</div>
                  <h2 className="mt-1 text-lg font-semibold text-viao-text">Fila de tickets</h2>
                </div>
                <div className="grid gap-2 md:grid-cols-3 xl:min-w-[640px]">
                  <input className={fieldClass} placeholder="Pesquisar tickets" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select className={fieldClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">Todos os estados</option>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em curso</option>
                    <option value="waiting_customer">À espera</option>
                    <option value="resolved">Resolvido</option>
                    <option value="closed">Fechado</option>
                  </select>
                  <select className={fieldClass} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                    <option value="all">Todas as prioridades</option>
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Total", metrics.total],
                  ["Resolvidos", metrics.resolved],
                  ["Ativos", metrics.open + metrics.inProgress],
                  ["Equipa", supportAgents.length],
                ].map(([label, value]) => (
                  <div key={String(label)} className={mutedCardClass}>
                    <div className="text-xs uppercase tracking-[0.1em] text-viao-muted">{label}</div>
                    <div className="mt-2 text-2xl font-semibold text-viao-text">{value as number}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["all", "Tudo", filteredTickets.length],
                  ["open", "Abertos", metrics.open],
                  ["in_progress", "Em curso", metrics.inProgress],
                  ["waiting_customer", "À espera", metrics.waiting],
                  ["resolved", "Resolvidos", metrics.resolved],
                ].map(([value, label, count]) => {
                  const active = statusFilter === value;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setStatusFilter(String(value))}
                      className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${
                        active ? "border-viao-accent bg-viao-accentLight text-viao-accent2" : "border-viao-line bg-white text-viao-muted hover:border-viao-accent/40"
                      }`}
                    >
                      {label} <span className="ml-1 text-[10px] font-medium opacity-70">{count as number}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-4">
              <article className={`${cardClass} min-w-0`} id="detail">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Tickets abertos</div>
                    <h3 className="mt-1 text-base font-semibold text-viao-text">Tabela operacional</h3>
                  </div>
                  <span className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1 text-xs text-viao-muted">{openTickets.length}</span>
                </div>

                <div className="mt-4 overflow-hidden rounded-[18px] border border-viao-line bg-white">
                  <div className="overflow-x-auto">
                    <div className={`${openTicketTableGridClass} border-b border-viao-line bg-viao-panelSoft px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted`}>
                      <div>Ações</div>
                      <div>Ticket</div>
                      <div>Cliente</div>
                      <div>Assunto</div>
                      <div>Categoria</div>
                      <div>SLA</div>
                      <div>Estado</div>
                      <div>Prioridade</div>
                      <div>Responsável</div>
                      <div>Due date</div>
                      <div>Origem</div>
                    </div>
                    <div className="divide-y divide-viao-line">
                      {openTickets.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-viao-muted">Sem tickets abertos.</div>
                      ) : (
                        openTickets.map((ticket) => {
                          const isSelected = selectedTicket?.id === ticket.id;
                          const isEditing = editingTicketId === ticket.id;
                          const overdue = ticket.due_at && new Date(ticket.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(ticket.status);
                          return (
                            <React.Fragment key={ticket.id}>
                              <div
                                className={`${openTicketTableGridClass} cursor-pointer px-4 py-4 transition ${isSelected ? "bg-viao-accentLight/40" : "hover:bg-viao-panelSoft/70"}`}
                                onClick={() => {
                                  setEditingTicketId(null);
                                  focusTicket(ticket.id, "overview").catch((err) => setError(err instanceof Error ? err.message : "Erro ao abrir ticket"));
                                }}
                                title="Abrir ticket"
                              >
                                <div className="relative flex flex-wrap gap-2 self-start" onClick={(event) => event.stopPropagation()}>
                                  <ActionIconButton
                                    title="Respostas rápidas"
                                    onClick={() => setQuickReplyMenuTicketId((current) => (current === ticket.id ? null : ticket.id))}
                                    accent={quickReplyMenuTicketId === ticket.id}
                                  >
                                    <ReplyIcon />
                                  </ActionIconButton>
                                  <ActionIconButton title="Editar ticket" onClick={() => openInlineEditor(ticket.id).catch((err) => setError(err instanceof Error ? err.message : "Erro ao abrir ticket"))}>
                                    <EditIcon />
                                  </ActionIconButton>
                                  <ActionIconButton
                                    title="Apagar ticket"
                                    onClick={() => deleteTicket(ticket.id)}
                                    disabled={!canManageTickets || isMutatingTicket}
                                    danger
                                  >
                                    <TrashIcon />
                                  </ActionIconButton>
                                  {quickReplyMenuTicketId === ticket.id ? (
                                    <div className="absolute left-0 top-10 z-20 w-72 rounded-[18px] border border-viao-line bg-white p-2 shadow-viao">
                                      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Respostas rápidas</div>
                                      <div className="mt-1 space-y-1">
                                        {cannedReplies.map((preset) => (
                                          <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => {
                                              setQuickReplyMenuTicketId(null);
                                              setEditingTicketId(null);
                                              focusTicket(ticket.id, "reply")
                                                .then(() => setReplyBody(preset.body))
                                                .catch((err) => setError(err instanceof Error ? err.message : "Erro ao abrir ticket"));
                                            }}
                                            className="block w-full rounded-[14px] px-3 py-2 text-left transition hover:bg-viao-panelSoft"
                                          >
                                            <div className="text-sm font-medium text-viao-text">{preset.label}</div>
                                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-viao-muted">{preset.body}</div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                <div>
                                  <div className="font-semibold text-viao-text">{ticketLabel(ticket)}</div>
                                  <div className="mt-2 text-[11px] text-viao-muted">Criado {formatLongDate(ticket.created_at)}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-viao-text">{ticket.requester_name}</div>
                                  <div className="mt-1 text-xs text-viao-muted">{ticket.requester_email}</div>
                                  <div className="mt-2 text-xs text-viao-muted">Tags: {ticket.tags?.length ? ticket.tags.join(", ") : "sem tags"}</div>
                                </div>
                                <div>
                                  <div className="font-medium text-viao-text">{ticket.subject}</div>
                                  <div className="mt-1 line-clamp-3 text-sm leading-6 text-viao-muted">{ticket.description}</div>
                                  <div className="mt-1 text-xs text-viao-muted">Atualizado {formatLongDate(ticket.updated_at || ticket.created_at)}</div>
                                  <div className="mt-1 text-xs text-viao-muted">{ticket.routing_reason || "sem roteamento explícito"}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-viao-text">{ticket.category || "sem categoria"}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-viao-text">{formatDuration(ticket.sla_minutes)}</div>
                                </div>
                                <div>
                                  <span className={statusPill(ticket.status)}>{ticket.status}</span>
                                </div>
                                <div>
                                  <span className={priorityPill(ticket.priority)}>{ticket.priority}</span>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-viao-text">{ticket.assignee_name || "sem responsável"}</div>
                                </div>
                                <div>
                                  <div className={`text-sm font-medium ${overdue ? "text-red-700" : "text-viao-text"}`}>{formatLongDate(ticket.due_at)}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-viao-text">{ticket.source || "portal"}</div>
                                </div>
                              </div>

                              {isSelected && selectedTicket ? (
                                <div className="px-4 pb-4">
                                  <div className="rounded-[22px] border border-viao-line bg-viao-panel p-5 shadow-viao">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Detalhe em linha</div>
                                        <h3 className="mt-1 text-xl font-semibold text-viao-text">{selectedTicket.subject}</h3>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          <span className={statusPill(selectedTicket.status)}>{selectedTicket.status}</span>
                                          <span className={priorityPill(selectedTicket.priority)}>{selectedTicket.priority}</span>
                                          <span className="rounded-full border border-viao-line bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-viao-muted">
                                            {selectedTicket.source || "portal"}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap gap-2">
                                        {([
                                          ["overview", "Visão geral"],
                                          ["reply", "Responder"],
                                          ["history", "Histórico"],
                                        ] as const).map(([tab, label]) => (
                                          <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setTicketPanelTab(tab)}
                                            className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${
                                              ticketPanelTab === tab ? "border-viao-accent bg-viao-accentLight text-viao-accent2" : "border-viao-line bg-white text-viao-muted hover:border-viao-accent/40"
                                            }`}
                                          >
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="mt-4">
                                      {ticketPanelTab === "overview" ? (
                                        <>
                                          <div className="rounded-[18px] border border-viao-line bg-white p-4">
                                            <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                                              <div>
                                                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Cliente</div>
                                                <div className="mt-1 font-medium text-viao-text">{selectedTicket.requester_name}</div>
                                                <div className="text-xs text-viao-muted">{selectedTicket.requester_email}</div>
                                              </div>
                                              <div>
                                                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Categoria</div>
                                                <div className="mt-1 font-medium text-viao-text">{selectedTicket.category || "sem categoria"}</div>
                                                <div className="text-xs text-viao-muted">Atualizado {formatLongDate(selectedTicket.updated_at || selectedTicket.created_at)}</div>
                                              </div>
                                              <div>
                                                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">SLA</div>
                                                <div className="mt-1 font-medium text-viao-text">{formatDuration(selectedTicket.sla_minutes)}</div>
                                                <div className="text-xs text-viao-muted">target de resposta</div>
                                              </div>
                                              <div>
                                                <div className="text-[11px] uppercase tracking-[0.08em] text-viao-muted">Due date</div>
                                                <div className={`mt-1 font-medium ${selectedTicket.due_at && new Date(selectedTicket.due_at).getTime() < Date.now() && !["resolved", "closed"].includes(selectedTicket.status) ? "text-red-700" : "text-viao-text"}`}>
                                                  {formatLongDate(selectedTicket.due_at)}
                                                </div>
                                                <div className="text-xs text-viao-muted">{selectedTicket.routing_reason || "sem roteamento explícito"}</div>
                                              </div>
                                            </div>
                                            <p className="mt-4 text-sm leading-6 text-viao-muted">{selectedTicket.description}</p>
                                          </div>

                                          <div className="mt-4 rounded-[18px] border border-dashed border-viao-line bg-white p-4 text-sm leading-6 text-viao-muted">
                                            Clique em <span className="font-semibold text-viao-text">Editar</span> na fila para abrir os campos logo abaixo deste ticket.
                                          </div>
                                        </>
                                      ) : ticketPanelTab === "reply" ? (
                                        <div className="grid gap-4 xl:grid-cols-2">
                                          <div className="rounded-[18px] border border-viao-line bg-white p-4">
                                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Reply público</div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                              {cannedReplies.map((preset) => (
                                                <button
                                                  key={preset.label}
                                                  type="button"
                                                  onClick={() => setReplyBody(preset.body)}
                                                  className="rounded-full border border-viao-line bg-viao-panelSoft px-3 py-1.5 text-[11px] font-medium text-viao-text transition hover:border-viao-accent/40 hover:bg-viao-accentLight"
                                                >
                                                  {preset.label}
                                                </button>
                                              ))}
                                            </div>
                                            <textarea className={`${fieldClass} mt-3 min-h-[140px] resize-y py-3`} placeholder="Responder ao cliente" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
                                            <div className="mt-3 rounded-2xl border border-dashed border-viao-line bg-viao-panelSoft p-3">
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-viao-accent">Anexos</div>
                                                  <div className="text-xs text-viao-muted">Até 5 ficheiros por resposta</div>
                                                </div>
                                                <div className="text-xs text-viao-muted">{replyAttachments.length}/5</div>
                                              </div>
                                              <input className="mt-3 block w-full text-sm text-viao-text file:mr-3 file:rounded-full file:border-0 file:bg-viao-accent file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" type="file" multiple onChange={handleReplyAttachmentChange} />
                                              {replyAttachments.length > 0 ? (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                  {replyAttachments.map((attachment, index) => (
                                                    <button
                                                      key={`${attachment.filename}-${index}`}
                                                      type="button"
                                                      onClick={() => setReplyAttachments((prev) => prev.filter((_, current) => current !== index))}
                                                      className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs font-medium text-viao-text transition hover:border-viao-accent/40"
                                                    >
                                                      {attachment.filename}
                                                    </button>
                                                  ))}
                                                </div>
                                              ) : null}
                                            </div>
                                            <button onClick={() => postConversation("reply")} disabled={isPostingReply} className="mt-3 h-10 w-full rounded-[12px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:cursor-wait disabled:opacity-70">
                                              {isPostingReply ? "A guardar..." : "Adicionar reply"}
                                            </button>
                                          </div>

                                          <div className="rounded-[18px] border border-viao-line bg-white p-4">
                                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Nota interna</div>
                                            <textarea className={`${fieldClass} mt-3 min-h-[100px] resize-y py-3`} placeholder="Registar nota interna" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                                            <button
                                              onClick={() => postConversation("note")}
                                              disabled={isPostingNote || !canManageTickets}
                                              className="mt-3 h-10 w-full rounded-[12px] bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
                                            >
                                              {canManageTickets ? (isPostingNote ? "A guardar..." : "Adicionar nota") : "Notas só para admins"}
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="rounded-[18px] border border-viao-line bg-white p-4">
                                          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Timeline</div>
                                          <div className="space-y-2">
                                            {(selectedTicket.conversations || []).length === 0 ? (
                                              <div className="rounded-2xl border border-dashed border-viao-line bg-viao-panelSoft px-4 py-5 text-sm text-viao-muted">
                                                Ainda sem interações.
                                              </div>
                                            ) : (
                                              (selectedTicket.conversations || []).map((item) => (
                                                <div key={item.id} className="rounded-2xl border border-viao-line bg-viao-panelSoft p-3">
                                                  <div className="flex items-center justify-between gap-3">
                                                    <div className="text-sm font-medium text-viao-text">{item.author_name}</div>
                                                    <div className="flex flex-wrap gap-2">
                                                      <span className="rounded-full border border-viao-line bg-white px-2.5 py-1 text-[11px] text-viao-muted">{item.kind}</span>
                                                      <span className="rounded-full border border-viao-line bg-white px-2.5 py-1 text-[11px] text-viao-muted">{item.visibility}</span>
                                                    </div>
                                                  </div>
                                                  <p className="mt-2 text-sm leading-6 text-viao-muted">{item.body}</p>
                                                  {(item.attachments || []).length > 0 ? (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                      {item.attachments?.map((attachment) => {
                                                        const href = `data:${attachment.content_type || "application/octet-stream"};base64,${attachment.content_b64}`;
                                                        return (
                                                          <a
                                                            key={attachment.id}
                                                            href={href}
                                                            download={attachment.filename}
                                                            className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs font-medium text-viao-text transition hover:border-viao-accent/40"
                                                          >
                                                            {attachment.filename}
                                                          </a>
                                                        );
                                                      })}
                                                    </div>
                                                  ) : null}
                                                  <div className="mt-2 text-[11px] text-viao-muted">{formatLongDate(item.created_at)}</div>
                                                </div>
                                              ))
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              {isEditing && selectedTicket ? (
                                <div className="px-4 pb-4">
                                  <div id={`ticket-inline-${ticket.id}`} className="rounded-[22px] border border-viao-line bg-viao-panel p-5 shadow-viao">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Editar ticket</div>
                                        <div className="mt-1 text-sm font-semibold text-viao-text">Campos pre-preenchidos diretamente abaixo do ticket</div>
                                        <div className="mt-1 text-xs text-viao-muted">As alterações podem ser guardadas com o botão abaixo, depois de ajustar os campos.</div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setEditingTicketId(null)}
                                        className="rounded-full border border-viao-line bg-white px-3 py-2 text-xs font-semibold text-viao-text transition hover:border-viao-accent/40"
                                      >
                                        Fechar edição
                                      </button>
                                    </div>

                                    <div className="mt-4 rounded-[18px] border border-viao-line bg-white p-4">
                                      <div className="grid gap-3 lg:grid-cols-2">
                                        <label className="grid gap-1">
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Estado</span>
                                          <select className={fieldClass} value={selectedTicket.status} disabled={!canEditTickets || isMutatingTicket} onChange={(e) => saveTicket(selectedTicket.id, { status: e.target.value }).catch(() => undefined)}>
                                            <option value="open">Aberto</option>
                                            <option value="in_progress">Em curso</option>
                                            <option value="waiting_customer">À espera do cliente</option>
                                            <option value="resolved">Resolvido</option>
                                            <option value="closed">Fechado</option>
                                          </select>
                                        </label>
                                        <label className="grid gap-1">
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Prioridade</span>
                                          <select className={fieldClass} value={selectedTicket.priority} disabled={!canEditTickets || isMutatingTicket} onChange={(e) => saveTicket(selectedTicket.id, { priority: e.target.value }).catch(() => undefined)}>
                                            <option value="low">Baixa</option>
                                            <option value="medium">Média</option>
                                            <option value="high">Alta</option>
                                            <option value="urgent">Urgente</option>
                                          </select>
                                        </label>
                                        <label className="grid gap-1 lg:col-span-2">
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Responsável</span>
                                          <select className={fieldClass} value={selectedAssignee} disabled={!canEditTickets || isMutatingTicket} onChange={(e) => saveTicket(selectedTicket.id, { assignee_name: e.target.value || null }).catch(() => undefined)}>
                                            <option value="">Sem responsável</option>
                                            {supportAgents.map((member) => (
                                              <option key={member.id} value={member.name || member.email || ""}>
                                                {member.name || member.email || `Membro ${member.id}`}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        <label className="grid gap-1">
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">SLA</span>
                                          <select className={fieldClass} value={selectedTicket.sla_minutes?.toString() || ""} disabled={!canEditTickets || isMutatingTicket} onChange={(e) => saveTicket(selectedTicket.id, { sla_minutes: e.target.value ? Number(e.target.value) : null }).catch(() => undefined)}>
                                            <option value="">SLA automático</option>
                                            {slaOptions.map((option) => (
                                              <option key={option.value} value={option.value}>
                                                {option.label}
                                              </option>
                                            ))}
                                            {selectedTicketSlaValueMissing ? <option value={selectedTicket.sla_minutes?.toString() || ""}>Personalizado ({formatDuration(selectedTicket.sla_minutes)})</option> : null}
                                          </select>
                                        </label>
                                        <label className="grid gap-1">
                                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-viao-muted">Data limite</span>
                                          <input className={fieldClass} type="datetime-local" value={toDatetimeLocalValue(selectedTicket.due_at)} disabled={!canEditTickets || isMutatingTicket} onChange={(e) => saveTicket(selectedTicket.id, { due_at: fromDatetimeLocalValue(e.target.value) }).catch(() => undefined)} />
                                        </label>
                                      </div>

                                      <div className="mt-4 rounded-[18px] border border-viao-line bg-viao-panelSoft p-4">
                                        <div className="flex items-center justify-between gap-3">
                                          <div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-viao-accent">Tags</div>
                                            <div className="mt-1 text-sm font-semibold text-viao-text">Etiquetas e triagem</div>
                                          </div>
                                          <span className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs text-viao-muted">{selectedTicket.tags?.length || 0}</span>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {(selectedTicket.tags || []).length === 0 ? (
                                            <span className="rounded-full border border-dashed border-viao-line bg-white px-3 py-1 text-xs text-viao-muted">Sem tags</span>
                                          ) : (
                                            (selectedTicket.tags || []).map((tag) => (
                                              <span key={tag} className="rounded-full border border-viao-line bg-white px-3 py-1 text-xs font-medium text-viao-text">
                                                {tag}
                                              </span>
                                            ))
                                          )}
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                          <input className={fieldClass} placeholder="tags separadas por vírgula" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} disabled={!canEditTickets || isMutatingTicket} />
                                          <button type="button" onClick={() => saveSelectedTicketTags().catch((err) => setError(err instanceof Error ? err.message : "Erro ao guardar tags"))} disabled={!canEditTickets || isMutatingTicket} className="h-10 rounded-[12px] bg-viao-accent px-4 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:opacity-60">
                                            Guardar tags
                                          </button>
                                        </div>
                                      </div>

                                      <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => saveInlineTicket().catch((err) => setError(err instanceof Error ? err.message : "Erro ao guardar ticket"))}
                                          disabled={!canEditTickets || isMutatingTicket}
                                          className="rounded-[12px] bg-viao-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-viao-accent2 disabled:opacity-60"
                                        >
                                          Guardar alterações
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingTicketId(null)}
                                          className="rounded-[12px] border border-viao-line bg-white px-4 py-2 text-sm font-semibold text-viao-text transition hover:border-viao-accent/40"
                                        >
                                          Fechar edição
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </React.Fragment>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </div>
      </div>
    </div>
    </main>
  );
}
