"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

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
  stored_count?: number;
  unread_count?: number;
  flagged_count?: number;
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
  body_text?: string | null;
  body_html?: string | null;
  received_at?: string | null;
  is_seen: boolean;
  is_flagged: boolean;
  has_attachments: boolean;
  remote_deleted: boolean;
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
    latest_emails?: EmailMessage[];
  };
};

type FolderStat = {
  folder: string;
  stored: number;
  unread: number;
};

type FolderOptionsPayload = {
  success: boolean;
  data?: {
    mailbox_id?: string;
    current_folder?: string;
    folders?: string[];
    folder_stats?: FolderStat[];
  };
};

type SectionKey = "favorites" | "mailboxes" | "folders";
type EmailAction = "mark_read" | "mark_unread" | "delete" | "move" | "flag" | "unflag";

const API_BASE = "/module/email/api-proxy";
const ALL_FOLDERS_KEY = "__all__";
const SIDEBAR_WIDTH_KEY = "email.module.sidebarWidth";
const LIST_WIDTH_KEY = "email.module.listWidth";
const EMAIL_ASSISTANT_CONTEXT_EVENT = "viao-email-assistant-context";
const SYNC_POLL_INTERVAL_MS = 5000;
const SYNC_POLL_MAX_ATTEMPTS = 90;

function formatListDate(value?: string | null) {
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

function formatLongDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function parseDateValue(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusClass(status: string) {
  if (["connected", "active", "sent"].includes(status)) return "tag success";
  if (["configured", "paused", "scheduled", "syncing"].includes(status)) return "tag warning";
  return "tag";
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
    case "syncing":
      return "a sincronizar";
    case "error":
      return "erro";
    default:
      return status || "—";
  }
}

function splitFolderSegments(folder: string) {
  return folder
    .split(/[./]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function trimInboxRoot(segments: string[]) {
  if (segments.length > 1 && segments[0]?.toLowerCase() === "inbox") {
    return segments.slice(1);
  }
  return segments;
}

function classifyFolderSegment(segment: string) {
  const normalized = segment.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "inbox") return { icon: "📥", label: "Caixa de entrada" };
  if (["sent", "sent items", "enviados"].includes(normalized)) return { icon: "📤", label: "Enviados" };
  if (["draft", "drafts", "rascunho", "rascunhos"].includes(normalized)) return { icon: "📝", label: "Rascunhos" };
  if (["archive", "archives", "arquivo", "arquivos"].includes(normalized)) return { icon: "🗄️", label: "Arquivo" };
  if (["spam", "junk", "bulk mail"].includes(normalized)) return { icon: "🚫", label: "Spam" };
  if (["trash", "bin", "lixo", "deleted"].includes(normalized)) return { icon: "🗑️", label: "Lixo" };
  return null;
}

function prettifyFolderSegment(segment: string) {
  const special = classifyFolderSegment(segment);
  if (!special) return segment;

  const normalized = segment.trim().toLowerCase();
  if (special.label === "Spam" && normalized !== "spam") return `${special.label} (${segment})`;
  if (special.label === "Lixo" && normalized !== "lixo" && normalized !== "trash") return `${special.label} (${segment})`;
  if (special.label === "Enviados" && normalized !== "enviados" && normalized !== "sent") return `${special.label} (${segment})`;
  if (special.label === "Rascunhos" && normalized !== "rascunhos" && normalized !== "drafts") return `${special.label} (${segment})`;
  return special.label;
}

function getFolderMeta(folder: string) {
  if (folder === ALL_FOLDERS_KEY) return { icon: "🗂", label: "Todas as pastas" };

  const rawSegments = splitFolderSegments(folder);
  const segments = trimInboxRoot(rawSegments);
  const safeSegments = segments.length ? segments : rawSegments;
  const specialIndex = safeSegments.findIndex((segment) => !!classifyFolderSegment(segment));
  const special = specialIndex >= 0 ? classifyFolderSegment(safeSegments[specialIndex]) : null;

  if (!safeSegments.length) {
    return { icon: "📁", label: folder };
  }

  const label = safeSegments
    .map((segment) => prettifyFolderSegment(segment))
    .join(" / ");

  return { icon: special?.icon || "📁", label };
}

function folderLabel(folder: string) {
  return getFolderMeta(folder).label;
}

function shouldIncludeFolderChildren(scopeFolder: string) {
  const raw = (scopeFolder || "").trim();
  if (!raw || raw === ALL_FOLDERS_KEY) return false;

  const normalized = raw.toLowerCase();
  const strictFolders = new Set([
    "inbox",
    "spam",
    "junk",
    "bulk mail",
    "trash",
    "bin",
    "deleted",
    "sent",
    "sent items",
    "enviados",
    "draft",
    "drafts",
    "rascunho",
    "rascunhos",
    "archive",
    "archives",
    "arquivo",
    "arquivos",
  ]);

  const segments = trimInboxRoot(splitFolderSegments(raw));
  const leaf = (segments.length ? segments[segments.length - 1] : normalized).toLowerCase();

  return !strictFolders.has(leaf);
}

function isFolderWithinScope(folder: string | null | undefined, scopeFolder: string) {

  const current = (folder || "INBOX").trim().toLowerCase();
  const scope = (scopeFolder || "INBOX").trim().toLowerCase();
  if (!scope || scope === ALL_FOLDERS_KEY.toLowerCase()) return true;
  if (current === scope) return true;
  if (!shouldIncludeFolderChildren(scopeFolder)) return false;
  return current.startsWith(`${scope}.`) || current.startsWith(`${scope}/`);
}

function displaySender(item: EmailMessage) {
  return item.from_name || item.from_address || "Remetente desconhecido";
}

function senderInitial(item: EmailMessage) {
  const sender = displaySender(item).trim();
  return sender ? sender.charAt(0).toUpperCase() : "?";
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function truncateAssistantBody(value?: string | null, limit = 2200) {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

export default function EmailPage() {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mailListRef = useRef<HTMLDivElement | null>(null);
  const syncPollTimerRef = useRef<number | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [userId, setUserId] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [platformRoles, setPlatformRoles] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL_FOLDERS_KEY);
  const [selectedEmailId, setSelectedEmailId] = useState("");
  const [selectedEmailIds, setSelectedEmailIds] = useState<string[]>([]);
  const [folderOptionsByMailbox, setFolderOptionsByMailbox] = useState<Record<string, string[]>>({});
  const [folderStatsByMailbox, setFolderStatsByMailbox] = useState<Record<string, FolderStat[]>>({});
  const [moveTargetByEmail, setMoveTargetByEmail] = useState<Record<string, string>>({});
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");
  const [draggingEmailId, setDraggingEmailId] = useState("");
  const [dragHoverFolder, setDragHoverFolder] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showAttachmentsOnly, setShowAttachmentsOnly] = useState(false);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    favorites: false,
    mailboxes: false,
    folders: false,
  });
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [listWidth, setListWidth] = useState(380);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [syncingMailboxId, setSyncingMailboxId] = useState<string | null>(null);
  const [actioningEmailId, setActioningEmailId] = useState<string | null>(null);
  const [bulkActioning, setBulkActioning] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedSidebar = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const storedList = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
    if (storedSidebar) setSidebarWidth(clampNumber(storedSidebar, 220, 360));
    if (storedList) setListWidth(clampNumber(storedList, 280, 540));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIST_WIDTH_KEY, String(listWidth));
  }, [listWidth]);

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

  async function loadDashboard(activeTenantId: string): Promise<Mailbox[]> {
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
      setSelectedFolder(ALL_FOLDERS_KEY);
      setSelectedEmailId("");
      setSelectedEmailIds([]);
      setEmails([]);
      return [];
    }

    setSelectedMailboxId((current) => {
      if (current && nextMailboxes.some((item) => item.id === current)) return current;
      return nextMailboxes[0]?.id || "";
    });

    return nextMailboxes;
  }

  async function loadEmails(activeTenantId: string, mailboxId?: string, folder?: string) {
    setMailLoading(true);
    try {
      const headers = buildHeaders(activeTenantId);
      const params = new URLSearchParams();
      if (mailboxId) params.set("mailbox_id", mailboxId);
      if (folder && folder !== ALL_FOLDERS_KEY) {
        params.set("folder", folder);
        if (shouldIncludeFolderChildren(folder)) {
          params.set("include_children", "true");
        }
      }
      params.set("limit", "250");
      const url = `${API_BASE}/api/emails?${params.toString()}`;
      const response = await fetch(url, { headers });
      const payload = await parseApiPayload(response);
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao carregar os emails sincronizados");
      }
      setEmails(Array.isArray((payload as { data?: EmailMessage[] } | null)?.data) ? (payload as { data?: EmailMessage[] }).data || [] : []);
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
      const folderStats = Array.isArray(payload?.data?.folder_stats) ? payload.data?.folder_stats || [] : [];
      setFolderOptionsByMailbox((current) => ({ ...current, [mailboxId]: folders }));
      setFolderStatsByMailbox((current) => ({ ...current, [mailboxId]: folderStats }));
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
    if (!selectedMailboxId) {
      setSelectedFolder(ALL_FOLDERS_KEY);
      setSelectedEmailId("");
      setSelectedEmailIds([]);
      return;
    }
    setSelectedFolder(ALL_FOLDERS_KEY);
    setSelectedEmailId("");
    setSelectedEmailIds([]);
    setBulkMoveTarget("");
    setSearchQuery("");
    setShowUnreadOnly(false);
    setShowAttachmentsOnly(false);
    setShowFlaggedOnly(false);
  }, [selectedMailboxId]);

  useEffect(() => {
    if (!tenantId || !selectedMailboxId) return;
    loadEmails(tenantId, selectedMailboxId, selectedFolder).catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar os emails");
    });
    loadFolders(tenantId, selectedMailboxId).catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar as pastas da mailbox");
    });
  }, [tenantId, selectedMailboxId, selectedFolder, userId, companyRole, platformRoles]);

  const summary = dashboard?.data?.summary || {};
  const mailboxes = dashboard?.data?.mailboxes || [];
  const selectedMailbox = mailboxes.find((item) => item.id === selectedMailboxId) || null;
  const selectedMailboxIsSyncing = !!selectedMailbox && (syncingMailboxId === selectedMailbox.id || selectedMailbox.status === "syncing");
  const folderStats = selectedMailboxId ? folderStatsByMailbox[selectedMailboxId] || [] : [];
  const folderOptions = selectedMailboxId ? folderOptionsByMailbox[selectedMailboxId] || [] : [];

  const totalStoredForMailbox = useMemo(
    () => folderStats.reduce((sum, item) => sum + item.stored, 0),
    [folderStats]
  );
  const totalUnreadForMailbox = useMemo(
    () => folderStats.reduce((sum, item) => sum + item.unread, 0),
    [folderStats]
  );

  const inboxFolder = useMemo(() => {
    const folderMatch = folderStats.find((item) => {
      const normalized = item.folder.toLowerCase();
      return normalized === "inbox" || normalized.endsWith(".inbox");
    });
    if (folderMatch) return folderMatch.folder;
    const optionMatch = folderOptions.find((folder) => {
      const normalized = folder.toLowerCase();
      return normalized === "inbox" || normalized.endsWith(".inbox");
    });
    return optionMatch || ALL_FOLDERS_KEY;
  }, [folderOptions, folderStats]);

  const inboxStats = useMemo(() => {
    if (!folderStats.length || inboxFolder === ALL_FOLDERS_KEY) return null;
    return folderStats.reduce<FolderStat | null>((summary, item) => {
      if (!isFolderWithinScope(item.folder, inboxFolder)) return summary;
      return {
        folder: inboxFolder,
        stored: (summary?.stored || 0) + item.stored,
        unread: (summary?.unread || 0) + item.unread,
      };
    }, null);
  }, [folderStats, inboxFolder]);

  const mailboxEmails = useMemo(() => {
    return selectedMailboxId ? emails.filter((item) => item.mailbox_id === selectedMailboxId) : emails;
  }, [emails, selectedMailboxId]);

  const flaggedCount = useMemo(() => mailboxEmails.filter((item) => item.is_flagged).length, [mailboxEmails]);
  const unreadCount = useMemo(() => mailboxEmails.filter((item) => !item.is_seen).length, [mailboxEmails]);
  const attachmentsCount = useMemo(() => mailboxEmails.filter((item) => item.has_attachments).length, [mailboxEmails]);

  const filteredEmails = useMemo(() => {
    let scoped = mailboxEmails;

    if (selectedFolder !== ALL_FOLDERS_KEY) {
      scoped = scoped.filter((item) => isFolderWithinScope(item.folder, selectedFolder));
    }

    if (showUnreadOnly) {
      scoped = scoped.filter((item) => !item.is_seen);
    }

    if (showAttachmentsOnly) {
      scoped = scoped.filter((item) => item.has_attachments);
    }

    if (showFlaggedOnly) {
      scoped = scoped.filter((item) => item.is_flagged);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      scoped = scoped.filter((item) => {
        const haystack = [
          item.subject,
          item.from_name,
          item.from_address,
          item.to_addresses,
          item.snippet,
          item.body_text,
          item.folder,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    return [...scoped].sort((left, right) => parseDateValue(right.received_at) - parseDateValue(left.received_at));
  }, [mailboxEmails, searchQuery, selectedFolder, showAttachmentsOnly, showFlaggedOnly, showUnreadOnly]);

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

  useEffect(() => {
    const visibleIds = new Set(filteredEmails.map((item) => item.id));
    setSelectedEmailIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [filteredEmails]);

  useEffect(() => {
    if (!filteredEmails.length) {
      setSelectedEmailId("");
      return;
    }
    if (!filteredEmails.some((item) => item.id === selectedEmailId)) {
      setSelectedEmailId(filteredEmails[0].id);
    }
  }, [filteredEmails, selectedEmailId]);

  useEffect(() => {
    mailListRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedFolder, selectedMailboxId]);

  const selectedEmail = filteredEmails.find((item) => item.id === selectedEmailId) || null;
  const selectedEmails = filteredEmails.filter((item) => selectedEmailIds.includes(item.id));
  const selectedMoveTarget = selectedEmail ? moveTargetByEmail[selectedEmail.id] || "" : "";
  const canWriteSelected =
    !!selectedMailbox && selectedMailbox.access_mode === "read_write" && !!selectedEmail && !selectedEmail.remote_deleted;
  const canMoveSelected =
    !!selectedEmail && !!selectedMoveTarget && selectedMoveTarget !== (selectedEmail.folder || "INBOX") && canWriteSelected;
  const bulkCanWrite =
    !!selectedMailbox &&
    selectedMailbox.access_mode === "read_write" &&
    selectedEmails.length > 0 &&
    selectedEmails.every((item) => !item.remote_deleted);
  const bulkCanMove = bulkCanWrite && !!bulkMoveTarget;
  const activeFilterCount = [showUnreadOnly, showAttachmentsOnly, showFlaggedOnly, !!searchQuery.trim()].filter(Boolean).length;
  const folderSelectionLabel = folderLabel(selectedFolder);
  const selectedFolderMeta = getFolderMeta(selectedFolder);
  const selectedEmailFolderMeta = getFolderMeta(selectedEmail?.folder || "INBOX");
  const activeQuickCategory = showFlaggedOnly
    ? "flagged"
    : showUnreadOnly
      ? "unread"
      : showAttachmentsOnly
        ? "attachments"
        : "all";
  const allVisibleSelected = filteredEmails.length > 0 && filteredEmails.every((item) => selectedEmailIds.includes(item.id));
  const mailLayoutStyle = {
    "--mail-sidebar-width": `${sidebarWidth}px`,
    "--mail-list-width": `${listWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const selectedContext = selectedEmail
      ? {
          id: selectedEmail.id,
          subject: selectedEmail.subject || "(Sem assunto)",
          from: displaySender(selectedEmail),
          fromAddress: selectedEmail.from_address || "",
          toAddresses: selectedEmail.to_addresses || "",
          folder: selectedEmail.folder || "INBOX",
          receivedAt: selectedEmail.received_at || "",
          snippet: selectedEmail.snippet || "",
          bodyPreview: truncateAssistantBody(selectedEmail.body_text || selectedEmail.snippet || selectedEmail.body_html || ""),
          isSeen: selectedEmail.is_seen,
          isFlagged: selectedEmail.is_flagged,
          hasAttachments: selectedEmail.has_attachments,
        }
      : null;

    const detail = {
      selectedEmailId: selectedEmail?.id || "",
      selectedEmailIds: selectedEmailIds.length > 0 ? selectedEmailIds : (selectedEmail ? [selectedEmail.id] : []),
      selectedMailboxId,
      selectedFolder,
      selectedEmail: selectedContext,
    };

    (window as Window & { __viaEmailAssistantContext?: typeof detail }).__viaEmailAssistantContext = detail;
    window.dispatchEvent(new CustomEvent(EMAIL_ASSISTANT_CONTEXT_EVENT, { detail }));
  }, [selectedEmail, selectedEmailIds, selectedMailboxId, selectedFolder]);

  function toggleSection(section: SectionKey) {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function setExclusiveFilter(kind: "all" | "flagged" | "unread" | "attachments") {
    setShowFlaggedOnly(kind === "flagged");
    setShowUnreadOnly(kind === "unread");
    setShowAttachmentsOnly(kind === "attachments");
  }

  function moveSelection(direction: -1 | 1) {
    if (!filteredEmails.length) return;
    const currentIndex = filteredEmails.findIndex((item) => item.id === selectedEmailId);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = clampNumber(safeIndex + direction, 0, filteredEmails.length - 1);
    setSelectedEmailId(filteredEmails[nextIndex].id);
  }

  function toggleEmailSelection(emailId: string, force?: boolean) {
    setSelectedEmailIds((current) => {
      const exists = current.includes(emailId);
      const shouldSelect = force ?? !exists;
      if (shouldSelect && !exists) return [...current, emailId];
      if (!shouldSelect && exists) return current.filter((item) => item !== emailId);
      return current;
    });
    if (!selectedEmailId) setSelectedEmailId(emailId);
  }

  function toggleSelectAllVisible(force?: boolean) {
    const visibleIds = filteredEmails.map((item) => item.id);
    const shouldSelect = force ?? !allVisibleSelected;
    setSelectedEmailIds(shouldSelect ? visibleIds : []);
    if (shouldSelect && filteredEmails[0]) {
      setSelectedEmailId(filteredEmails[0].id);
    }
  }

  function getActionTargetIds(preferredEmailId?: string) {
    if (preferredEmailId && selectedEmailIds.includes(preferredEmailId) && selectedEmailIds.length > 0) {
      return selectedEmailIds;
    }
    if (preferredEmailId) return [preferredEmailId];
    return selectedEmailIds;
  }

  function handleFolderDragOver(event: ReactDragEvent<HTMLElement>, folder: string) {
    if (!draggingEmailId || folder === ALL_FOLDERS_KEY) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragHoverFolder(folder);
  }

  function handleFolderDragLeave(folder: string) {
    if (dragHoverFolder === folder) {
      setDragHoverFolder("");
    }
  }

  async function handleFolderDrop(folder: string) {
    if (!draggingEmailId || !folder || folder === ALL_FOLDERS_KEY) return;
    const targetIds = getActionTargetIds(draggingEmailId);
    setDragHoverFolder("");
    setDraggingEmailId("");
    if (!targetIds.length) return;
    await applyBulkAction("move", folder, targetIds);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, emailId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedEmailId(emailId);
    }
  }

  function startResize(kind: "sidebar" | "list", event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startListWidth = listWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (kind === "sidebar") {
        setSidebarWidth(clampNumber(startSidebarWidth + delta, 220, 360));
        return;
      }
      setListWidth(clampNumber(startListWidth + delta, 280, 540));
    };

    const onUp = () => {
      document.body.classList.remove("is-resizing-mail");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.classList.add("is-resizing-mail");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function clearSyncPollTimer() {
    if (typeof window === "undefined") return;
    if (syncPollTimerRef.current !== null) {
      window.clearTimeout(syncPollTimerRef.current);
      syncPollTimerRef.current = null;
    }
  }

  async function refreshAll(preferredMailboxId?: string): Promise<Mailbox[]> {
    if (!tenantId) return [];
    const mailboxIdToLoad = preferredMailboxId || selectedMailboxId || undefined;
    const folderToLoad = selectedFolder || ALL_FOLDERS_KEY;
    const nextMailboxes = await loadDashboard(tenantId);
    if (mailboxIdToLoad) {
      await Promise.all([loadEmails(tenantId, mailboxIdToLoad, folderToLoad), loadFolders(tenantId, mailboxIdToLoad)]);
    }
    return nextMailboxes;
  }

  async function parseApiPayload(response: Response) {
    const raw = await response.text();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return { detail: raw };
    }
  }

  useEffect(() => () => {
    clearSyncPollTimer();
  }, []);

  async function trackQueuedSync(mailboxId: string, attempt = 0) {
    try {
      const nextMailboxes = await refreshAll(mailboxId);
      const mailbox = nextMailboxes.find((item) => item.id === mailboxId);
      if (!mailbox || mailbox.status !== "syncing") {
        clearSyncPollTimer();
        setSyncingMailboxId(null);
        return;
      }
      if (attempt >= SYNC_POLL_MAX_ATTEMPTS) {
        clearSyncPollTimer();
        setSyncingMailboxId(null);
        setSuccess("A sincronização continua em segundo plano. Atualize a mailbox dentro de alguns instantes.");
        return;
      }
      clearSyncPollTimer();
      syncPollTimerRef.current = window.setTimeout(() => {
        void trackQueuedSync(mailboxId, attempt + 1);
      }, SYNC_POLL_INTERVAL_MS);
    } catch (err) {
      clearSyncPollTimer();
      setSyncingMailboxId(null);
      setError(err instanceof Error ? err.message : "Erro ao acompanhar a sincronização da mailbox");
    }
  }

  async function sendEmailAction(emailId: string, action: EmailAction, targetFolder?: string) {
    const response = await fetch(`${API_BASE}/api/emails/${emailId}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildHeaders(tenantId),
      },
      body: JSON.stringify({ action, target_folder: targetFolder }),
    });
    const payload = await parseApiPayload(response);
    if (!response.ok) {
      throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao atualizar o estado remoto do email");
    }
    return payload;
  }

  async function syncMailbox(mailboxId: string) {
    if (!tenantId) return;
    let keepTracking = false;
    clearSyncPollTimer();
    setSyncingMailboxId(mailboxId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/api/mailboxes/${mailboxId}/sync`, {
        method: "POST",
        headers: buildHeaders(tenantId),
      });
      const payload = await parseApiPayload(response);
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao sincronizar a mailbox");
      }
      const payloadData = (payload as {
        data?: {
          sync_result?: { mailbox_name?: string; fetched?: number; folders_synced?: number; created?: number; updated?: number };
          queued?: boolean;
          message?: string;
          limit?: number;
        };
      } | null)?.data;
      const syncResult = payloadData?.sync_result;
      setSuccess(
        syncResult
          ? `Sincronizada ${syncResult.mailbox_name}: ${syncResult.fetched} emails lidos em ${syncResult.folders_synced || 1} pasta(s), ${syncResult.created} novos, ${syncResult.updated} atualizados.`
          : payloadData?.message || "Sincronização concluída."
      );
      const nextMailboxes = await refreshAll(mailboxId);
      const mailbox = nextMailboxes.find((item) => item.id === mailboxId);
      if (payloadData?.queued || mailbox?.status === "syncing") {
        keepTracking = true;
        void trackQueuedSync(mailboxId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar a mailbox");
    } finally {
      if (!keepTracking) {
        clearSyncPollTimer();
        setSyncingMailboxId(null);
      }
    }
  }

  async function applyEmailAction(emailId: string, action: EmailAction, targetFolder?: string) {
    if (!tenantId) return;
    setActioningEmailId(emailId);
    setError("");
    setSuccess("");
    try {
      const payload = await sendEmailAction(emailId, action, targetFolder);
      setSuccess(payload?.data?.message || "Email atualizado.");
      await refreshAll(selectedMailboxId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar o estado do email");
    } finally {
      setActioningEmailId(null);
    }
  }

  async function applyBulkAction(action: EmailAction, targetFolder?: string, emailIdsOverride?: string[]) {
    const targetIds = emailIdsOverride?.length ? emailIdsOverride : selectedEmailIds;
    if (!tenantId || targetIds.length === 0) return;
    setBulkActioning(true);
    setError("");
    setSuccess("");

    let successCount = 0;
    const failures: string[] = [];

    for (const emailId of targetIds) {
      try {
        await sendEmailAction(emailId, action, targetFolder);
        successCount += 1;
      } catch (err) {
        failures.push(err instanceof Error ? err.message : "Falha desconhecida");
      }
    }

    if (successCount > 0) {
      const actionLabels: Record<EmailAction, string> = {
        mark_read: "marcados como lidos",
        mark_unread: "marcados como por ler",
        delete: "apagados",
        move: targetFolder ? `movidos para ${folderLabel(targetFolder)}` : "movidos",
        flag: "marcados como importantes",
        unflag: "desmarcados como importantes",
      };
      setSuccess(`${successCount} email(s) ${actionLabels[action]}.`);
      await refreshAll(selectedMailboxId || undefined);
    }

    if (failures.length > 0) {
      setError(`Falha em ${failures.length} email(s): ${failures[0]}`);
    }

    if (!emailIdsOverride || targetIds.every((id) => selectedEmailIds.includes(id))) {
      setSelectedEmailIds((current) => current.filter((id) => !targetIds.includes(id)));
    }
    if (action === "move") setBulkMoveTarget("");
    setBulkActioning(false);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditing = !!target && (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT");

      if (event.key === "/" && !isEditing) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (isEditing) {
        if (event.key === "Escape" && tag === "INPUT") {
          (target as HTMLInputElement).blur();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && filteredEmails.length) {
        event.preventDefault();
        toggleSelectAllVisible(true);
        return;
      }

      if ((event.key === "ArrowDown" || event.key.toLowerCase() === "j") && filteredEmails.length) {
        event.preventDefault();
        moveSelection(1);
        return;
      }

      if ((event.key === "ArrowUp" || event.key.toLowerCase() === "k") && filteredEmails.length) {
        event.preventDefault();
        moveSelection(-1);
        return;
      }

      if (event.key.toLowerCase() === "x" && selectedEmail) {
        event.preventDefault();
        toggleEmailSelection(selectedEmail.id);
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshAll(selectedMailboxId || undefined);
        return;
      }

      if (event.key.toLowerCase() === "u" && selectedEmail && canWriteSelected) {
        event.preventDefault();
        void applyEmailAction(selectedEmail.id, selectedEmail.is_seen ? "mark_unread" : "mark_read");
        return;
      }

      if (event.key.toLowerCase() === "f" && selectedEmail && canWriteSelected) {
        event.preventDefault();
        void applyEmailAction(selectedEmail.id, selectedEmail.is_flagged ? "unflag" : "flag");
        return;
      }

      if (event.key === "Delete") {
        if (selectedEmailIds.length > 1 && bulkCanWrite) {
          event.preventDefault();
          void applyBulkAction("delete");
          return;
        }
        if (selectedEmail && canWriteSelected) {
          event.preventDefault();
          void applyEmailAction(selectedEmail.id, "delete");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bulkCanWrite,
    canWriteSelected,
    filteredEmails,
    selectedEmail,
    selectedEmailId,
    selectedEmailIds,
    selectedMailboxId,
  ]);

  return (
    <main className="shell">
      <div className="stack">
        <section className="hero">
          <div className="hero-top">
            <div>
              <div className="eyebrow">Via Oceânica AI · Caixa de email</div>
              <h1 className="title">Cliente de email</h1>
              <p className="subtitle">
                Este módulo corre dentro da aplicação principal Via Oceânica AI e usa o contexto real da empresa. Agora sincroniza todas as pastas IMAP disponíveis e apresenta a caixa de correio num layout mais próximo de webmail.
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
              <div className="kpi-label">Campanhas e automações</div>
              <div className="kpi-value">{(summary.active_automations ?? 0) + (summary.draft_campaigns ?? 0) + (summary.scheduled_campaigns ?? 0)}</div>
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

        <section className="panel mail-app-card">
          {loading ? (
            <div className="empty">A preparar o cliente de email...</div>
          ) : mailboxes.length === 0 ? (
            <div className="empty">Ainda não existem mailboxes IMAP configuradas.</div>
          ) : (
            <>
              <div className="mail-toolbar">
                <div>
                  <h2>{selectedMailbox?.name || "Mailboxes"}</h2>
                  <p className="lead">
                    {selectedMailbox
                      ? `${selectedMailbox.email_address} · ${mailboxAccessLabel(selectedMailbox.access_mode)} · ${selectedMailbox.sync_enabled ? "sincronização ativa" : "sincronização desligada"}`
                      : "Selecione uma mailbox para navegar nas pastas e emails."}
                  </p>
                </div>
                {selectedMailbox ? (
                  <div className="mail-toolbar-actions">
                    <span className={statusClass(selectedMailbox.status)}>{mailboxStatusLabel(selectedMailbox.status)}</span>
                    <button
                      className="admin-button secondary"
                      onClick={() => void syncMailbox(selectedMailbox.id)}
                      disabled={selectedMailboxIsSyncing || !selectedMailbox.sync_enabled}
                      type="button"
                    >
                      {selectedMailboxIsSyncing ? "A sincronizar..." : "Sincronizar tudo"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mail-command-bar">
                <label className="mail-search" aria-label="Pesquisar emails">
                  <span className="mail-search-icon">⌕</span>
                  <input
                    ref={searchInputRef}
                    className="mail-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Pesquisar por remetente, assunto ou texto"
                  />
                </label>
                <div className="mail-command-actions">
                  <button
                    className={`toolbar-chip ${showUnreadOnly ? "active" : ""}`}
                    onClick={() => setShowUnreadOnly((current) => !current)}
                    type="button"
                  >
                    Não lidos
                  </button>
                  <button
                    className={`toolbar-chip ${showAttachmentsOnly ? "active" : ""}`}
                    onClick={() => setShowAttachmentsOnly((current) => !current)}
                    type="button"
                  >
                    Com anexos
                  </button>
                  <button
                    className={`toolbar-chip ${showFlaggedOnly ? "active" : ""}`}
                    onClick={() => setShowFlaggedOnly((current) => !current)}
                    type="button"
                  >
                    Importantes
                  </button>
                  <button
                    className="toolbar-chip"
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setShowUnreadOnly(false);
                      setShowAttachmentsOnly(false);
                      setShowFlaggedOnly(false);
                    }}
                    disabled={activeFilterCount === 0}
                  >
                    Limpar filtros
                  </button>
                  <button
                    className="admin-button secondary"
                    type="button"
                    onClick={() => void refreshAll(selectedMailboxId || undefined)}
                    disabled={mailLoading || foldersLoading || loading}
                  >
                    Atualizar vista
                  </button>
                </div>
              </div>

              <div className="mail-shortcuts-bar">
                <span>Atalhos</span>
                <span>/ pesquisar</span>
                <span>↑ ↓ navegar</span>
                <span>X selecionar</span>
                <span>Ctrl+A selecionar visíveis</span>
                <span>F importante</span>
                <span>U lido</span>
                <span>R atualizar</span>
              </div>

              <div className="mail-category-strip">
                <button
                  className={`category-chip ${activeQuickCategory === "all" ? "active" : ""}`}
                  onClick={() => setExclusiveFilter("all")}
                  type="button"
                >
                  Tudo <strong>{mailboxEmails.length}</strong>
                </button>
                <button
                  className={`category-chip ${activeQuickCategory === "flagged" ? "active" : ""}`}
                  onClick={() => setExclusiveFilter("flagged")}
                  type="button"
                >
                  Importantes <strong>{flaggedCount}</strong>
                </button>
                <button
                  className={`category-chip ${activeQuickCategory === "unread" ? "active" : ""}`}
                  onClick={() => setExclusiveFilter("unread")}
                  type="button"
                >
                  Não lidos <strong>{unreadCount}</strong>
                </button>
                <button
                  className={`category-chip ${activeQuickCategory === "attachments" ? "active" : ""}`}
                  onClick={() => setExclusiveFilter("attachments")}
                  type="button"
                >
                  Com anexos <strong>{attachmentsCount}</strong>
                </button>
              </div>

              <div className="mail-layout" style={mailLayoutStyle}>
                <aside className="mail-sidebar">
                  <div className="nav-section">
                    <button className="nav-section-toggle" type="button" onClick={() => toggleSection("favorites")}> 
                      <span>{collapsedSections.favorites ? "▸" : "▾"}</span>
                      <span>Favoritos</span>
                    </button>
                    {!collapsedSections.favorites ? (
                      <div className="favorite-list">
                        <button
                          className={`favorite-button ${selectedFolder === inboxFolder && activeQuickCategory === "all" ? "active" : ""} ${dragHoverFolder === inboxFolder ? "drag-target" : ""}`}
                          onClick={() => {
                            setSelectedFolder(inboxFolder);
                            setExclusiveFilter("all");
                          }}
                          onDragOver={(event) => handleFolderDragOver(event, inboxFolder)}
                          onDragLeave={() => handleFolderDragLeave(inboxFolder)}
                          onDrop={(event) => {
                            event.preventDefault();
                            void handleFolderDrop(inboxFolder);
                          }}
                          type="button"
                        >
                          <span className="favorite-main">
                            <span aria-hidden="true">📥</span>
                            <span>Caixa de entrada</span>
                          </span>
                          <span className="favorite-count">{inboxStats?.unread ?? 0}</span>
                        </button>
                        <button
                          className={`favorite-button ${activeQuickCategory === "flagged" ? "active" : ""}`}
                          onClick={() => {
                            setSelectedFolder(ALL_FOLDERS_KEY);
                            setExclusiveFilter("flagged");
                          }}
                          type="button"
                        >
                          <span className="favorite-main">
                            <span aria-hidden="true">⭐</span>
                            <span>Importantes</span>
                          </span>
                          <span className="favorite-count">{flaggedCount}</span>
                        </button>
                        <button
                          className={`favorite-button ${activeQuickCategory === "unread" ? "active" : ""}`}
                          onClick={() => {
                            setSelectedFolder(ALL_FOLDERS_KEY);
                            setExclusiveFilter("unread");
                          }}
                          type="button"
                        >
                          <span className="favorite-main">
                            <span aria-hidden="true">👁</span>
                            <span>Não lidos</span>
                          </span>
                          <span className="favorite-count">{unreadCount}</span>
                        </button>
                        <button
                          className={`favorite-button ${activeQuickCategory === "attachments" ? "active" : ""}`}
                          onClick={() => {
                            setSelectedFolder(ALL_FOLDERS_KEY);
                            setExclusiveFilter("attachments");
                          }}
                          type="button"
                        >
                          <span className="favorite-main">
                            <span aria-hidden="true">📎</span>
                            <span>Com anexos</span>
                          </span>
                          <span className="favorite-count">{attachmentsCount}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="nav-section">
                    <button className="nav-section-toggle" type="button" onClick={() => toggleSection("mailboxes")}> 
                      <span>{collapsedSections.mailboxes ? "▸" : "▾"}</span>
                      <span>Mailboxes</span>
                    </button>
                    {!collapsedSections.mailboxes ? (
                      <div className="mailbox-list compact-list">
                        {mailboxes.map((item) => (
                          <button
                            key={item.id}
                            className={`mailbox-button ${selectedMailboxId === item.id ? "active" : ""}`}
                            onClick={() => setSelectedMailboxId(item.id)}
                            type="button"
                          >
                            <div>
                              <div className="mailbox-button-title">{item.name}</div>
                              <div className="mailbox-button-subtitle">{item.email_address}</div>
                              <div className="mailbox-button-counters">
                                <span>{item.unread_count ?? 0} por ler</span>
                                <span>{item.stored_count ?? 0} total</span>
                                <span>{item.flagged_count ?? 0} importantes</span>
                              </div>
                            </div>
                            <span className={statusClass(item.status)}>{mailboxStatusLabel(item.status)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="nav-section">
                    <button className="nav-section-toggle" type="button" onClick={() => toggleSection("folders")}> 
                      <span>{collapsedSections.folders ? "▸" : "▾"}</span>
                      <span>Pastas</span>
                    </button>
                    {!collapsedSections.folders ? (
                      selectedMailbox ? (
                        <div className="folder-list compact-list">
                          <button
                            className={`folder-button ${selectedFolder === ALL_FOLDERS_KEY ? "active" : ""}`}
                            onClick={() => setSelectedFolder(ALL_FOLDERS_KEY)}
                            type="button"
                          >
                            <span className="folder-main">
                              <span className="folder-icon" aria-hidden="true">
                                {getFolderMeta(ALL_FOLDERS_KEY).icon}
                              </span>
                              <span className="folder-name">Todas as pastas</span>
                            </span>
                            <span className="folder-badges">
                              {totalUnreadForMailbox > 0 ? <span className="folder-unread-badge">{totalUnreadForMailbox}</span> : null}
                              <span className="folder-count">{totalStoredForMailbox}</span>
                            </span>
                          </button>
                          {folderStats.map((item) => {
                            const meta = getFolderMeta(item.folder);
                            const visibleStats = item.folder === inboxFolder && inboxStats ? inboxStats : item;
                            return (
                              <button
                                key={item.folder}
                                className={`folder-button ${selectedFolder === item.folder ? "active" : ""} ${dragHoverFolder === item.folder ? "drag-target" : ""}`}
                                onClick={() => setSelectedFolder(item.folder)}
                                onDragOver={(event) => handleFolderDragOver(event, item.folder)}
                                onDragLeave={() => handleFolderDragLeave(item.folder)}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  void handleFolderDrop(item.folder);
                                }}
                                title={item.folder}
                                type="button"
                              >
                                <span className="folder-main">
                                  <span className="folder-icon" aria-hidden="true">
                                    {meta.icon}
                                  </span>
                                  <span className="folder-name">{meta.label}</span>
                                </span>
                                <span className="folder-badges">
                                  {visibleStats.unread > 0 ? <span className="folder-unread-badge">{visibleStats.unread}</span> : null}
                                  <span className="folder-count">{visibleStats.stored}</span>
                                </span>
                              </button>
                            );
                          })}
                          {!folderStats.length && !foldersLoading ? <div className="empty compact">Ainda não há pastas sincronizadas.</div> : null}
                        </div>
                      ) : (
                        <div className="empty compact">Selecione uma mailbox.</div>
                      )
                    ) : null}
                  </div>

                  {selectedMailbox ? (
                    <div className="mail-section mailbox-summary">
                      <div className="mail-section-label">Resumo da mailbox</div>
                      <div className="meta">
                        <span className="tag">Pasta principal {selectedMailbox.folder || "INBOX"}</span>
                        <span className="tag">Porta {selectedMailbox.imap_port || "—"}</span>
                        <span className="tag">{selectedMailbox.security_mode === "ssl_tls" ? "SSL/TLS" : selectedMailbox.security_mode === "starttls" ? "STARTTLS" : "IMAP simples"}</span>
                        <span className="tag">TLS {selectedMailbox.validate_certificates ? "validado" : "sem validação"}</span>
                      </div>
                      <div className="admin-inline-meta">
                        <span>Última sincronização {formatListDate(selectedMailbox.last_synced_at)}</span>
                      </div>
                      {selectedMailbox.last_error ? <p className="admin-inline-error">Último erro: {selectedMailbox.last_error}</p> : null}
                    </div>
                  ) : null}
                </aside>

                <div className="mail-resizer" onMouseDown={(event) => startResize("sidebar", event)} role="separator" aria-orientation="vertical" />

                <section className="mail-list-column">
                  <div className="mail-column-header">
                    <div>
                      <h3>
                        <span className="folder-icon heading-icon" aria-hidden="true">
                          {selectedFolderMeta.icon}
                        </span>{" "}
                        {folderSelectionLabel}
                      </h3>
                      <p>
                        {mailLoading
                          ? "A carregar emails..."
                          : `${filteredEmails.length} de ${mailboxEmails.length} email(s) visíveis${activeFilterCount ? ` · ${activeFilterCount} filtro(s) ativo(s)` : ""}`}
                      </p>
                    </div>
                    <div className="mail-column-actions">
                      <button className="toolbar-chip small" type="button" onClick={() => toggleSelectAllVisible()} disabled={!filteredEmails.length}>
                        {allVisibleSelected ? "Limpar seleção" : "Selecionar visíveis"}
                      </button>
                      {foldersLoading ? <span className="tag warning">A carregar pastas</span> : null}
                    </div>
                  </div>

                  {selectedEmailIds.length > 0 ? (
                    <div className="bulk-action-bar">
                      <div className="bulk-action-summary">{selectedEmailIds.length} email(s) selecionados</div>
                      <div className="bulk-action-controls">
                        <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("mark_read")} disabled={!bulkCanWrite || bulkActioning}>
                          Marcar lidos
                        </button>
                        <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("mark_unread")} disabled={!bulkCanWrite || bulkActioning}>
                          Marcar por ler
                        </button>
                        <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("flag")} disabled={!bulkCanWrite || bulkActioning}>
                          Tornar importantes
                        </button>
                        <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("unflag")} disabled={!bulkCanWrite || bulkActioning}>
                          Remover importante
                        </button>
                        <select className="bulk-select" value={bulkMoveTarget} onChange={(event) => setBulkMoveTarget(event.target.value)} disabled={!bulkCanWrite || bulkActioning}>
                          <option value="">Mover para...</option>
                          {folderOptions.map((folder) => (
                            <option key={`bulk-${folder}`} value={folder}>
                              {folderLabel(folder)}
                            </option>
                          ))}
                        </select>
                        <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("move", bulkMoveTarget)} disabled={!bulkCanMove || bulkActioning}>
                          Mover
                        </button>
                        <button className="toolbar-chip small danger" type="button" onClick={() => void applyBulkAction("delete")} disabled={!bulkCanWrite || bulkActioning}>
                          Apagar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {mailLoading ? (
                    <div className="empty">A carregar emails sincronizados...</div>
                  ) : filteredEmails.length === 0 ? (
                    <div className="empty">Não existem emails nesta seleção. Execute uma sincronização ou ajuste os filtros para continuar.</div>
                  ) : (
                    <div className="mail-list compact-mail-list" ref={mailListRef}>
                      {filteredEmails.map((item) => {
                        const canWriteRow = !!selectedMailbox && selectedMailbox.access_mode === "read_write" && !item.remote_deleted;
                        return (
                          <div
                            key={item.id}
                            className={`mail-row slim ${selectedEmailId === item.id ? "active" : ""} ${item.is_seen ? "" : "unread"}`}
                            onClick={() => setSelectedEmailId(item.id)}
                            onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                            onDragStart={(event) => {
                              if (!canWriteRow) return;
                              setDraggingEmailId(item.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", item.id);
                            }}
                            onDragEnd={() => {
                              setDraggingEmailId("");
                              setDragHoverFolder("");
                            }}
                            draggable={canWriteRow}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="mail-row-status-dot" aria-hidden="true" />
                            <label className="mail-row-check" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedEmailIds.includes(item.id)}
                                onChange={(event) => toggleEmailSelection(item.id, event.target.checked)}
                              />
                            </label>
                            <div className="mail-row-avatar" aria-hidden="true">
                              {senderInitial(item)}
                            </div>
                            <div className="mail-row-main">
                              <div className="mail-row-top">
                                <span className="mail-row-sender">{displaySender(item)}</span>
                                <div className="mail-row-header-actions">
                                  <button
                                    className={`mail-row-star-button ${item.is_flagged ? "active" : ""}`}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!canWriteRow || actioningEmailId === item.id) return;
                                      void applyEmailAction(item.id, item.is_flagged ? "unflag" : "flag");
                                    }}
                                    disabled={!canWriteRow || actioningEmailId === item.id}
                                  >
                                    {item.is_flagged ? "★" : "☆"}
                                  </button>
                                  <span className="mail-row-date">{formatListDate(item.received_at)}</span>
                                </div>
                              </div>
                              <div className="mail-row-subject-line">
                                <span className="mail-row-subject">{item.subject || "(Sem assunto)"}</span>
                                <span className="mail-row-badges">
                                  {item.is_flagged ? <span className="mini-badge important">Importante</span> : null}
                                  {item.has_attachments ? <span className="mini-badge">Anexos</span> : null}
                                  {!item.is_seen ? <span className="mini-badge unread">Por ler</span> : null}
                                </span>
                              </div>
                              <div className="mail-row-snippet">{item.snippet || "Sem pré-visualização disponível."}</div>
                              <div className="mail-row-meta">
                                <span className="folder-inline-pill" title={item.folder || "INBOX"}>
                                  <span aria-hidden="true">{getFolderMeta(item.folder || "INBOX").icon}</span>
                                  <span>{folderLabel(item.folder || "INBOX")}</span>
                                </span>
                                {item.remote_deleted ? <span>Removido remotamente</span> : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <div className="mail-resizer" onMouseDown={(event) => startResize("list", event)} role="separator" aria-orientation="vertical" />

                <section className="mail-reader">
                  {!selectedEmail ? (
                    <div className="empty reader-empty">Selecione um email para abrir a pré-visualização.</div>
                  ) : (
                    <>
                      <div className="reader-shell">
                        <div className="mail-reader-header reader-header-card">
                          <div className="reader-persona">
                            <div className="reader-avatar" aria-hidden="true">{senderInitial(selectedEmail)}</div>
                            <div>
                              <h3>{selectedEmail.subject || "(Sem assunto)"}</h3>
                              <p>
                                <strong>De:</strong> {displaySender(selectedEmail)}
                              </p>
                              <p>
                                <strong>Para:</strong> {selectedEmail.to_addresses || "—"}
                              </p>
                              <p>
                                <strong>Data:</strong> {formatLongDate(selectedEmail.received_at)}
                              </p>
                            </div>
                          </div>
                          <div className="meta">
                            <span className="tag">
                              {selectedEmailFolderMeta.icon} {folderLabel(selectedEmail.folder || "INBOX")}
                            </span>
                            <span className="tag">{selectedMailbox ? mailboxAccessLabel(selectedMailbox.access_mode) : "Só leitura"}</span>
                            {selectedEmail.is_flagged ? <span className="tag important">★ Importante</span> : null}
                            {selectedEmail.has_attachments ? <span className="tag">Anexos</span> : null}
                            {!selectedEmail.is_seen ? <span className="tag warning">Por ler</span> : null}
                          </div>
                        </div>

                        <div className="reader-ribbon">
                          <div className="reader-ribbon-title">Ações rápidas</div>
                          <div className="mail-reader-actions">
                            <button
                              className={`admin-button secondary ${selectedEmail.is_flagged ? "active-toggle" : ""}`}
                              disabled={!canWriteSelected || actioningEmailId === selectedEmail.id}
                              onClick={() => void applyEmailAction(selectedEmail.id, selectedEmail.is_flagged ? "unflag" : "flag")}
                              type="button"
                            >
                              {selectedEmail.is_flagged ? "Remover importante" : "Marcar importante"}
                            </button>
                            <button
                              className="admin-button secondary"
                              disabled={!canWriteSelected || actioningEmailId === selectedEmail.id || selectedEmail.is_seen}
                              onClick={() => void applyEmailAction(selectedEmail.id, "mark_read")}
                              type="button"
                            >
                              Marcar como lido
                            </button>
                            <button
                              className="admin-button secondary"
                              disabled={!canWriteSelected || actioningEmailId === selectedEmail.id || !selectedEmail.is_seen}
                              onClick={() => void applyEmailAction(selectedEmail.id, "mark_unread")}
                              type="button"
                            >
                              Marcar como por ler
                            </button>
                            <button
                              className="admin-button danger"
                              disabled={!canWriteSelected || actioningEmailId === selectedEmail.id}
                              onClick={() => void applyEmailAction(selectedEmail.id, "delete")}
                              type="button"
                            >
                              Apagar
                            </button>
                          </div>
                        </div>
                      </div>

                      {selectedMailbox && selectedMailbox.access_mode !== "read_write" ? (
                        <p className="footer-note">Esta mailbox está em modo só de leitura, por isso as ações remotas estão desativadas.</p>
                      ) : null}

                      <div className="move-row move-row-wide">
                        <select
                          className="admin-input"
                          value={selectedMoveTarget}
                          onChange={(event) =>
                            setMoveTargetByEmail((current) => ({
                              ...current,
                              [selectedEmail.id]: event.target.value,
                            }))
                          }
                          disabled={!canWriteSelected}
                        >
                          <option value="">Selecionar pasta de destino</option>
                          {folderOptions.map((folder) => (
                            <option key={`${selectedEmail.id}-${folder}`} value={folder}>
                              {folderLabel(folder)}
                            </option>
                          ))}
                        </select>
                        <button
                          className="admin-button secondary"
                          disabled={!canMoveSelected || actioningEmailId === selectedEmail.id || foldersLoading}
                          onClick={() => void applyEmailAction(selectedEmail.id, "move", selectedMoveTarget)}
                          type="button"
                        >
                          Mover para pasta
                        </button>
                      </div>

                      <div className="mail-reader-body">
                        {selectedEmail.body_text?.trim()
                          ? selectedEmail.body_text
                          : selectedEmail.snippet || "Sem conteúdo sincronizado para apresentar ainda."}
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Contexto da empresa</h2>
          <p className="lead">
            Empresa <strong>{tenantId || "—"}</strong>, utilizador <strong>{userId || "—"}</strong>, perfil <strong>{companyRole || "membro"}</strong>.
          </p>
          <p className="footer-note">
            A configuração das mailboxes fica no painel de administração de Email. Esta vista principal cobre sincronização de todas as pastas, navegação tipo webmail e ações remotas básicas em mailboxes IMAP com escrita.
          </p>
        </section>
      </div>
    </main>
  );
}
