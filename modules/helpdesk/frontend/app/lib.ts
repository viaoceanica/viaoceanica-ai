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
};

export type TicketDetail = Ticket & {
  conversations?: Conversation[];
};

export type TicketStatusResponse = {
  success: boolean;
  data: {
    module: string;
    tenant_id: string;
    message: string;
  };
};

export type AdminSummaryResponse = {
  success: boolean;
  data?: {
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
  items?: AdminCatalogItem[];
};

export function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/module/helpdesk/admin")) {
    return "/api/module/helpdesk";
  }
  return "/module/helpdesk/api-proxy";
}

export const emptyForm = {
  requester_name: "",
  requester_email: "",
  subject: "",
  description: "",
  priority: "medium",
  category: "general",
};

export const cardClass = "rounded-xl border border-viao-line bg-white p-5 shadow-viao";
export const mutedCardClass = "rounded-xl border border-viao-line bg-viao-panelSoft p-4 shadow-viao";
export const fieldClass = "h-10 w-full rounded-[8px] border border-viao-line bg-white px-3.5 text-sm text-viao-text outline-none transition focus:border-viao-accent/70 focus:ring-4 focus:ring-viao-accent/10 placeholder:text-slate-400";

export function priorityPill(priority: string): string {
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
