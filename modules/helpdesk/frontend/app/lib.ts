export type Ticket = {
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
  due_at?: string | null;
  sla_minutes?: number | null;
  routing_reason?: string | null;
  source?: string | null;
  tags?: string[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type Conversation = {
  id: string;
  ticket_id: string;
  tenant_id: string;
  kind: string;
  author_name: string;
  author_email?: string | null;
  body: string;
  visibility: string;
  created_at?: string | null;
  attachments?: ConversationAttachment[];
};

export type ConversationAttachment = {
  id: string;
  ticket_id: string;
  conversation_id: string;
  tenant_id: string;
  filename: string;
  content_type?: string | null;
  content_b64: string;
  created_at?: string | null;
};

export type TicketDetail = Ticket & {
  conversations?: Conversation[];
};

export type TicketStatusResponse = {
  success: boolean;
  data: {
    module: string;
    tenant_id: string;
    user_id?: string;
    company_role?: string;
    message: string;
  };
};

export type AdminSummaryResponse = {
  success: boolean;
  data?: {
    module?: string;
    tenant_id?: string;
    admin_access?: boolean;
    company_role?: string;
    platform_roles?: string;
    message?: string;
    summary?: Record<string, number>;
  };
};

export type AdminResourceField = {
  key: string;
  label: string;
  required?: boolean;
};

export type AdminCatalogItem = {
  id: string;
  [key: string]: string;
};

export type AdminCatalogResource = {
  label: string;
  fields: AdminResourceField[];
  read_only?: boolean;
  items?: AdminCatalogItem[];
};

export type PlatformMember = {
  id: number;
  name?: string | null;
  email?: string | null;
  companyRole?: string | null;
  teamId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function getApiBase(): string {
  return "/module/helpdesk/api-proxy";
}

export function getPlatformApiBase(): string {
  return "/api/platform/tenants";
}

export const emptyForm = {
  requester_name: "",
  requester_email: "",
  subject: "",
  description: "",
  priority: "medium",
  category: "",
  sla_minutes: "",
  due_at: "",
};

export const cardClass = "rounded-[22px] border border-viao-line bg-viao-panel p-5 shadow-viao";
export const mutedCardClass = "rounded-[18px] border border-viao-line bg-viao-panelSoft p-4 shadow-viao";
export const fieldClass =
  "h-10 w-full rounded-[12px] border border-viao-line bg-viao-bg px-3.5 text-sm text-viao-text outline-none transition focus:border-viao-accent/70 focus:ring-4 focus:ring-viao-accent/10 placeholder:text-slate-400";

export function priorityPill(priority: string): string {
  const base = "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em]";
  switch (priority) {
    case "urgent":
      return `${base} border-red-200 bg-red-50 text-red-700`;
    case "high":
      return `${base} border-amber-200 bg-amber-50 text-amber-700`;
    case "medium":
      return `${base} border-viao-accent/20 bg-viao-accentLight text-viao-accent2`;
    case "low":
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
  }
}

export function statusPill(status: string): string {
  const base = "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.08em]";
  switch (status) {
    case "open":
      return `${base} border-sky-200 bg-sky-50 text-sky-700`;
    case "in_progress":
      return `${base} border-amber-200 bg-amber-50 text-amber-700`;
    case "waiting_customer":
      return `${base} border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700`;
    case "resolved":
      return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
    case "closed":
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
  }
}

export function rolePill(role: string | null | undefined): string {
  const base = "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em]";
  switch (role) {
    case "owner":
      return `${base} border-viao-accent/20 bg-viao-accentLight text-viao-accent2`;
    case "admin":
      return `${base} border-indigo-200 bg-indigo-50 text-indigo-700`;
    case "member":
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-600`;
  }
}

export function ticketGroupLabel(status: string): string {
  switch (status) {
    case "open":
      return "Aberto";
    case "in_progress":
      return "Em curso";
    case "waiting_customer":
      return "A aguardar cliente";
    case "resolved":
      return "Resolvido";
    case "closed":
      return "Fechado";
    default:
      return status;
  }
}
