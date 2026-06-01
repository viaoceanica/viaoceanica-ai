"use client";

import {
  useCallback,
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
  message_id_header?: string | null;
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
  if (!safeSegments.length) return { icon: "📁", label: folder };
  const label = safeSegments.map((segment) => prettifyFolderSegment(segment)).join(" / ");
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
    "inbox", "spam", "junk", "bulk mail", "trash", "bin", "deleted",
    "sent", "sent items", "enviados", "draft", "drafts", "rascunho",
    "rascunhos", "archive", "archives", "arquivo", "arquivos",
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
  const dragExpandTimerRef = useRef<number | null>(null);
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
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem("via-email-collapsed-sections");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { favorites: false, mailboxes: true, folders: true };
  });
  const [collapsedFolderGroups, setCollapsedFolderGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("via-email-collapsed-folder-groups");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });
  const [sidebarWidth, setSidebarWidth] = useState(180);
  const [listWidth, setListWidth] = useState(300);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [syncingMailboxId, setSyncingMailboxId] = useState<string | null>(null);
  const [actioningEmailId, setActioningEmailId] = useState<string | null>(null);
  const [bulkActioning, setBulkActioning] = useState(false);
  const [attachments, setAttachments] = useState<Array<{index: number; filename: string; content_type: string; size: number}>>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCacheRef = useRef<Record<string, string>>({});

  // Compose / Reply state
  type ComposeMode = "reply" | "reply_all" | "forward" | null;
  const [composeMode, setComposeMode] = useState<ComposeMode>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const composeBodyRef = useRef<HTMLTextAreaElement>(null);
  const composeFileInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);

  // Listen for fullscreen change events (e.g. user presses Esc)
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const goingFullscreen = !prev;
      if (goingFullscreen) {
        // Try native fullscreen API on the iframe element or shell
        const target = (window.frameElement as HTMLElement) || shellRef.current;
        if (target?.requestFullscreen) {
          target.requestFullscreen().catch(() => { /* CSS fallback already applied via state */ });
        }
      } else {
        // Exit native fullscreen if active
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
      return goingFullscreen;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedSidebar = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const storedList = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
    if (storedSidebar) setSidebarWidth(clampNumber(storedSidebar, 180, 320));
    if (storedList) setListWidth(clampNumber(storedList, 260, 480));
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
    } catch { /* ignore */ }

    const readyTimer = window.setTimeout(() => setContextReady(true), 400);
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
    if (!statusRes.ok) throw new Error(statusJson?.data?.message || "Falha ao carregar o estado do módulo Email");
    if (!dashboardRes.ok) throw new Error("Falha ao carregar o espaço de trabalho de Email");
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

  async function loadEmails(activeTenantId: string, mailboxId?: string, folder?: string, options?: { silent?: boolean }) {
    const isSilent = options?.silent && emails.length > 0;
    if (!isSilent) setMailLoading(true);
    try {
      const headers = buildHeaders(activeTenantId);
      const params = new URLSearchParams();
      if (mailboxId) params.set("mailbox_id", mailboxId);
      if (folder && folder !== ALL_FOLDERS_KEY) {
        params.set("folder", folder);
        if (shouldIncludeFolderChildren(folder)) params.set("include_children", "true");
      }
      params.set("limit", "100");
      const url = `${API_BASE}/api/emails?${params.toString()}`;
      const response = await fetch(url, { headers });
      const payload = await parseApiPayload(response);
      if (!response.ok) throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao carregar os emails sincronizados");
      const freshEmails = Array.isArray((payload as { data?: EmailMessage[] } | null)?.data) ? (payload as { data?: EmailMessage[] }).data || [] : [];
      if (isSilent) {
        // Incremental merge: keep existing emails, add new ones at the top, update changed ones
        setEmails((current) => {
          const existingMap = new Map(current.map((e) => [e.id, e]));
          const merged: EmailMessage[] = [];
          const seenIds = new Set<string>();
          for (const email of freshEmails) {
            merged.push(email);
            seenIds.add(email.id);
          }
          // Keep any locally-known emails that are no longer in the API response
          // (they might have been moved/deleted, so we don't keep them)
          return merged;
        });
      } else {
        setEmails(freshEmails);
      }
    } finally {
      if (!isSilent) setMailLoading(false);
    }
  }

  async function loadFolders(activeTenantId: string, mailboxId: string) {
    setFoldersLoading(true);
    try {
      const headers = buildHeaders(activeTenantId);
      const response = await fetch(`${API_BASE}/api/mailboxes/${mailboxId}/folders`, { headers });
      const payload = (await response.json()) as FolderOptionsPayload;
      if (!response.ok) throw new Error(payload?.data?.current_folder || "Falha ao carregar as pastas da mailbox");
      const folders = Array.isArray(payload?.data?.folders) ? payload.data?.folders || [] : [];
      const folderStatsData = Array.isArray(payload?.data?.folder_stats) ? payload.data?.folder_stats || [] : [];
      setFolderOptionsByMailbox((current) => ({ ...current, [mailboxId]: folders }));
      setFolderStatsByMailbox((current) => ({ ...current, [mailboxId]: folderStatsData }));
    } finally {
      setFoldersLoading(false);
    }
  }

  useEffect(() => {
    if (!contextReady) return;
    if (!tenantId) {
      setLoading(false);
      setError("Não foi possível obter o contexto da empresa.");
      return;
    }
    async function load() {
      setLoading(true);
      setError("");
      try { await loadDashboard(tenantId); }
      catch (err) { setError(err instanceof Error ? err.message : "Erro ao carregar o módulo Email"); }
      finally { setLoading(false); }
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

  const totalStoredForMailbox = useMemo(() => folderStats.reduce((sum, item) => sum + item.stored, 0), [folderStats]);
  const totalUnreadForMailbox = useMemo(() => folderStats.reduce((sum, item) => sum + item.unread, 0), [folderStats]);

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
    return folderStats.reduce<FolderStat | null>((acc, item) => {
      if (!isFolderWithinScope(item.folder, inboxFolder)) return acc;
      return { folder: inboxFolder, stored: (acc?.stored || 0) + item.stored, unread: (acc?.unread || 0) + item.unread };
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
    if (selectedFolder !== ALL_FOLDERS_KEY) scoped = scoped.filter((item) => isFolderWithinScope(item.folder, selectedFolder));
    if (showUnreadOnly) scoped = scoped.filter((item) => !item.is_seen);
    if (showAttachmentsOnly) scoped = scoped.filter((item) => item.has_attachments);
    if (showFlaggedOnly) scoped = scoped.filter((item) => item.is_flagged);
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      scoped = scoped.filter((item) => {
        const haystack = [item.subject, item.from_name, item.from_address, item.to_addresses, item.snippet, item.body_text, item.folder].filter(Boolean).join(" ").toLowerCase();
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
    if (!filteredEmails.length) { setSelectedEmailId(""); return; }
    if (!filteredEmails.some((item) => item.id === selectedEmailId)) setSelectedEmailId(filteredEmails[0].id);
  }, [filteredEmails, selectedEmailId]);

  useEffect(() => { mailListRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [selectedFolder, selectedMailboxId]);

  const selectedEmail = filteredEmails.find((item) => item.id === selectedEmailId) || null;
  const selectedEmails = filteredEmails.filter((item) => selectedEmailIds.includes(item.id));
  const selectedMoveTarget = selectedEmail ? moveTargetByEmail[selectedEmail.id] || "" : "";
  const canWriteSelected = !!selectedMailbox && selectedMailbox.access_mode === "read_write" && !!selectedEmail && !selectedEmail.remote_deleted;
  const canMoveSelected = !!selectedEmail && !!selectedMoveTarget && selectedMoveTarget !== (selectedEmail.folder || "INBOX") && canWriteSelected;
  const bulkCanWrite = !!selectedMailbox && selectedMailbox.access_mode === "read_write" && selectedEmails.length > 0 && selectedEmails.every((item) => !item.remote_deleted);
  const bulkCanMove = bulkCanWrite && !!bulkMoveTarget;
  const activeFilterCount = [showUnreadOnly, showAttachmentsOnly, showFlaggedOnly, !!searchQuery.trim()].filter(Boolean).length;
  const folderSelectionLabel = folderLabel(selectedFolder);
  const selectedFolderMeta = getFolderMeta(selectedFolder);
  const selectedEmailFolderMeta = getFolderMeta(selectedEmail?.folder || "INBOX");
  const activeQuickCategory = showFlaggedOnly ? "flagged" : showUnreadOnly ? "unread" : showAttachmentsOnly ? "attachments" : "all";
  const allVisibleSelected = filteredEmails.length > 0 && filteredEmails.every((item) => selectedEmailIds.includes(item.id));
  const mailLayoutStyle = { "--mail-sidebar-width": `${sidebarWidth}px`, "--mail-list-width": `${listWidth}px` } as CSSProperties;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const selectedContext = selectedEmail ? {
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
    } : null;
    const detail = {
      selectedEmailId: selectedEmail?.id || "",
      selectedEmailIds: selectedEmailIds.length > 0 ? selectedEmailIds : (selectedEmail ? [selectedEmail.id] : []),
      selectedMailboxId,
      selectedFolder,
      selectedEmail: selectedContext,
    };
    (window as Window & { __viaEmailAssistantContext?: typeof detail }).__viaEmailAssistantContext = detail;
    window.dispatchEvent(new CustomEvent(EMAIL_ASSISTANT_CONTEXT_EVENT, { detail }));
    window.parent?.postMessage({ type: EMAIL_ASSISTANT_CONTEXT_EVENT, detail }, "*");
  }, [selectedEmail, selectedEmailIds, selectedMailboxId, selectedFolder]);

  // Load attachments when an email with attachments is selected
  useEffect(() => {
    if (!selectedEmail?.has_attachments || !tenantId) {
      setAttachments([]);
      setAttachmentsExpanded(false);
      return;
    }
    setAttachmentsLoading(true);
    fetch(`${API_BASE}/api/emails/${selectedEmail.id}/attachments`, {
      headers: buildHeaders(tenantId)
    })
      .then(r => r.json())
      .then(d => { setAttachments(d.data || []); setAttachmentsExpanded(true); })
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [selectedEmail?.id, selectedEmail?.has_attachments, tenantId]);

  // Preload all attachments in background when preview modal opens
  useEffect(() => {
    if (!previewOpen || !selectedEmail || !tenantId || attachments.length === 0) return;
    previewCacheRef.current = {};
    const emailId = selectedEmail.id;
    attachments.forEach((att) => {
      const cacheKey = `${emailId}-${att.index}`;
      if (att.content_type.startsWith("image/")) {
        // Preload images via Image object
        const img = new Image();
        img.src = `${API_BASE}/api/emails/${emailId}/attachments/${att.index}?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`;
        img.onload = () => { previewCacheRef.current[cacheKey] = "loaded"; };
      } else if (att.content_type.includes("pdf") || att.filename.match(/\.pdf$/i) || att.content_type.includes("word") || att.content_type.includes("document") || att.filename.match(/\.docx?$/i) || att.content_type.includes("spreadsheet") || att.content_type.includes("excel") || att.filename.match(/\.xlsx?$/i)) {
        // Preload preview endpoint via fetch (warms server cache)
        const previewUrl = `${API_BASE}/api/emails/${emailId}/attachments/${att.index}/preview?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`;
        fetch(previewUrl).then(() => { previewCacheRef.current[cacheKey] = "loaded"; }).catch(() => {});
      }
    });
  }, [previewOpen, selectedEmail?.id, attachments, tenantId]);

  // Track loading state when switching between attachments
  useEffect(() => {
    if (!previewOpen || attachments.length === 0 || !selectedEmail) return;
    const att = attachments[previewIndex];
    if (!att) return;
    const cacheKey = `${selectedEmail.id}-${att.index}`;
    if (previewCacheRef.current[cacheKey] === "loaded") {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    // Set a timeout fallback to hide loading after max 8s
    const timeout = setTimeout(() => setPreviewLoading(false), 8000);
    return () => clearTimeout(timeout);
  }, [previewOpen, previewIndex, attachments, selectedEmail?.id]);

  function toggleSection(section: SectionKey) {
    setCollapsedSections((current) => {
      const next = { ...current, [section]: !current[section] };
      try { localStorage.setItem("via-email-collapsed-sections", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function toggleFolderGroup(groupKey: string) {
    setCollapsedFolderGroups((current) => {
      // Default state is collapsed (undefined or true means collapsed, false means expanded)
      const isCurrentlyCollapsed = current[groupKey] !== false;
      const next = { ...current, [groupKey]: isCurrentlyCollapsed ? false : true };
      try { localStorage.setItem("via-email-collapsed-folder-groups", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Group folders into parent/children hierarchy for collapsible sub-folders
  const groupedFolders = useMemo(() => {
    type FolderGroup = { parent: FolderStat; children: FolderStat[] };
    const groups: (FolderStat | FolderGroup)[] = [];
    const parentMap = new Map<string, FolderGroup>();

    for (const item of folderStats) {
      const segments = splitFolderSegments(item.folder);
      const trimmed = trimInboxRoot(segments);
      if (trimmed.length > 1) {
        // This is a sub-folder — find or create parent group
        const parentKey = trimmed[0];
        // Try to find the parent folder path (reconstruct from original)
        const parentFolder = segments.length > trimmed.length
          ? segments.slice(0, segments.length - trimmed.length + 1).join(".")
          : parentKey;
        if (!parentMap.has(parentKey)) {
          // Check if parent already exists as a standalone entry
          const existingParentIndex = groups.findIndex((g) => {
            if ("children" in g) return false;
            const pSegments = trimInboxRoot(splitFolderSegments((g as FolderStat).folder));
            return pSegments.length === 1 && pSegments[0] === parentKey;
          });
          if (existingParentIndex >= 0) {
            const existing = groups[existingParentIndex] as FolderStat;
            const group: FolderGroup = { parent: existing, children: [item] };
            groups[existingParentIndex] = group;
            parentMap.set(parentKey, group);
          } else {
            // Create a virtual parent
            const virtualParent: FolderStat = { folder: parentFolder, stored: 0, unread: 0 };
            const group: FolderGroup = { parent: virtualParent, children: [item] };
            groups.push(group);
            parentMap.set(parentKey, group);
          }
        } else {
          parentMap.get(parentKey)!.children.push(item);
        }
      } else {
        // Top-level folder — check if it should become a group parent
        const key = trimmed[0] || item.folder;
        if (parentMap.has(key)) {
          // Already has children, update parent stats
          parentMap.get(key)!.parent = item;
        } else {
          groups.push(item);
        }
      }
    }
    return groups;
  }, [folderStats]);

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
    if (shouldSelect && filteredEmails[0]) setSelectedEmailId(filteredEmails[0].id);
  }

  function getActionTargetIds(preferredEmailId?: string) {
    if (preferredEmailId && selectedEmailIds.includes(preferredEmailId) && selectedEmailIds.length > 0) return selectedEmailIds;
    if (preferredEmailId) return [preferredEmailId];
    return selectedEmailIds;
  }

  function handleFolderDragOver(event: ReactDragEvent<HTMLElement>, folder: string, groupKey?: string) {
    if (!draggingEmailId || folder === ALL_FOLDERS_KEY) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragHoverFolder(folder);
    // Auto-expand collapsed folder group after 800ms hover
    if (groupKey && collapsedFolderGroups[groupKey] !== false) {
      if (dragExpandTimerRef.current === null) {
        dragExpandTimerRef.current = window.setTimeout(() => {
          setCollapsedFolderGroups((current) => {
            const next = { ...current, [groupKey]: false };
            try { localStorage.setItem("via-email-collapsed-folder-groups", JSON.stringify(next)); } catch {}
            return next;
          });
          dragExpandTimerRef.current = null;
        }, 800);
      }
    }
  }

  function handleFolderDragLeave(folder: string) {
    if (dragHoverFolder === folder) setDragHoverFolder("");
    // Clear auto-expand timer when leaving
    if (dragExpandTimerRef.current !== null) {
      window.clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
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
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedEmailId(emailId); }
  }

  function startResize(kind: "sidebar" | "list", event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startListWidth = listWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (kind === "sidebar") { setSidebarWidth(clampNumber(startSidebarWidth + delta, 180, 320)); return; }
      setListWidth(clampNumber(startListWidth + delta, 260, 480));
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
    if (syncPollTimerRef.current !== null) { window.clearTimeout(syncPollTimerRef.current); syncPollTimerRef.current = null; }
  }

  async function refreshAll(preferredMailboxId?: string, options?: { silent?: boolean }): Promise<Mailbox[]> {
    if (!tenantId) return [];
    const mailboxIdToLoad = preferredMailboxId || selectedMailboxId || undefined;
    const folderToLoad = selectedFolder || ALL_FOLDERS_KEY;
    const nextMailboxes = await loadDashboard(tenantId);
    if (mailboxIdToLoad) await Promise.all([loadEmails(tenantId, mailboxIdToLoad, folderToLoad, options), loadFolders(tenantId, mailboxIdToLoad)]);
    return nextMailboxes;
  }

  async function parseApiPayload(response: Response) {
    const raw = await response.text();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return { detail: raw }; }
  }

  useEffect(() => () => { clearSyncPollTimer(); }, []);

  async function trackQueuedSync(mailboxId: string, attempt = 0) {
    try {
      const nextMailboxes = await refreshAll(mailboxId, { silent: true });
      const mailbox = nextMailboxes.find((item) => item.id === mailboxId);
      if (!mailbox || mailbox.status !== "syncing") { clearSyncPollTimer(); setSyncingMailboxId(null); return; }
      if (attempt >= SYNC_POLL_MAX_ATTEMPTS) { clearSyncPollTimer(); setSyncingMailboxId(null); setSuccess("A sincronização continua em segundo plano."); return; }
      clearSyncPollTimer();
      syncPollTimerRef.current = window.setTimeout(() => { void trackQueuedSync(mailboxId, attempt + 1); }, SYNC_POLL_INTERVAL_MS);
    } catch (err) {
      clearSyncPollTimer();
      setSyncingMailboxId(null);
      setError(err instanceof Error ? err.message : "Erro ao acompanhar a sincronização da mailbox");
    }
  }

  async function sendEmailAction(emailId: string, action: EmailAction, targetFolder?: string) {
    const response = await fetch(`${API_BASE}/api/emails/${emailId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildHeaders(tenantId) },
      body: JSON.stringify({ action, target_folder: targetFolder }),
    });
    const payload = await parseApiPayload(response);
    if (!response.ok) throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao atualizar o estado remoto do email");
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
      const response = await fetch(`${API_BASE}/api/mailboxes/${mailboxId}/sync`, { method: "POST", headers: buildHeaders(tenantId) });
      const payload = await parseApiPayload(response);
      if (!response.ok) throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao sincronizar a mailbox");
      const payloadData = (payload as { data?: { sync_result?: { mailbox_name?: string; fetched?: number; folders_synced?: number; created?: number; updated?: number }; queued?: boolean; message?: string; limit?: number } } | null)?.data;
      const syncResult = payloadData?.sync_result;
      setSuccess(syncResult ? `Sincronizada ${syncResult.mailbox_name}: ${syncResult.fetched} emails, ${syncResult.created} novos, ${syncResult.updated} atualizados.` : payloadData?.message || "Sincronização concluída.");
      const nextMailboxes = await refreshAll(mailboxId);
      const mailbox = nextMailboxes.find((item) => item.id === mailboxId);
      if (payloadData?.queued || mailbox?.status === "syncing") { keepTracking = true; void trackQueuedSync(mailboxId); }
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao sincronizar a mailbox"); }
    finally { if (!keepTracking) { clearSyncPollTimer(); setSyncingMailboxId(null); } }
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
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao atualizar o estado do email"); }
    finally { setActioningEmailId(null); }
  }

  function openCompose(mode: "reply" | "reply_all" | "forward") {
    if (!selectedEmail) return;
    const email = selectedEmail;
    setComposeMode(mode);
    if (mode === "reply") {
      setComposeTo(email.from_address || "");
      setComposeCc("");
      setComposeSubject(email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject || ""}`);
    } else if (mode === "reply_all") {
      setComposeTo(email.from_address || "");
      // Add all original recipients except our own mailbox
      const ownEmail = selectedMailbox?.email_address?.toLowerCase() || "";
      const allTo = (email.to_addresses || "").split(",").map(a => a.trim()).filter(a => a && a.toLowerCase() !== ownEmail && a.toLowerCase() !== (email.from_address || "").toLowerCase());
      setComposeCc(allTo.join(", "));
      setComposeSubject(email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject || ""}`);
    } else if (mode === "forward") {
      setComposeTo("");
      setComposeCc("");
      setComposeSubject(email.subject?.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject || ""}`);
    }
    const originalBody = email.body_text?.trim() || email.snippet || "";
    const quotedHeader = `\n\n--- Mensagem original ---\nDe: ${email.from_name || ""} <${email.from_address || ""}>\nData: ${formatLongDate(email.received_at)}\nAssunto: ${email.subject || ""}\n\n`;
    setComposeBody(mode === "forward" ? quotedHeader + originalBody : "\n" + quotedHeader + originalBody);
    setTimeout(() => composeBodyRef.current?.focus(), 200);
  }

  function closeCompose() {
    setComposeMode(null);
    setComposeTo("");
    setComposeCc("");
    setComposeSubject("");
    setComposeBody("");
    setComposeAttachments([]);
    if (composeFileInputRef.current) composeFileInputRef.current.value = "";
  }

  async function handleSendReply() {
    if (!selectedEmail || !tenantId || !composeMode) return;
    if (!composeTo.trim()) { setError("É necessário pelo menos um destinatário."); return; }
    setComposeSending(true);
    setError("");
    setSuccess("");
    try {
      const bodyHtml = `<div style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${composeBody.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</div>`;
      let response: Response;
      if (composeAttachments.length > 0) {
        const formData = new FormData();
        formData.append("mode", composeMode);
        formData.append("to", composeTo.trim());
        formData.append("cc", composeCc.trim());
        formData.append("subject", composeSubject.trim());
        formData.append("body_html", bodyHtml);
        formData.append("body_text", composeBody);
        formData.append("in_reply_to", selectedEmail.message_id_header || "");
        for (const file of composeAttachments) {
          formData.append("attachments", file, file.name);
        }
        const hdrs = buildHeaders(tenantId);
        response = await fetch(`${API_BASE}/api/emails/${selectedEmail.id}/send`, {
          method: "POST",
          headers: hdrs,
          body: formData,
        });
      } else {
        response = await fetch(`${API_BASE}/api/emails/${selectedEmail.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildHeaders(tenantId) },
          body: JSON.stringify({
            mode: composeMode,
            to: composeTo.trim(),
            cc: composeCc.trim() || undefined,
            subject: composeSubject.trim(),
            body_html: bodyHtml,
            body_text: composeBody,
            in_reply_to: selectedEmail.message_id_header || undefined,
          }),
        });
      }
      const payload = await parseApiPayload(response);
      if (!response.ok) throw new Error((payload as { detail?: string } | null)?.detail || "Falha ao enviar o email");
      setSuccess("Email enviado com sucesso!");
      closeCompose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar o email");
    } finally {
      setComposeSending(false);
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
      try { await sendEmailAction(emailId, action, targetFolder); successCount += 1; }
      catch (err) { failures.push(err instanceof Error ? err.message : "Falha desconhecida"); }
    }
    if (successCount > 0) {
      const actionLabels: Record<EmailAction, string> = { mark_read: "marcados como lidos", mark_unread: "marcados como por ler", delete: "apagados", move: targetFolder ? `movidos para ${folderLabel(targetFolder)}` : "movidos", flag: "marcados como importantes", unflag: "desmarcados como importantes" };
      setSuccess(`${successCount} email(s) ${actionLabels[action]}.`);
      await refreshAll(selectedMailboxId || undefined);
    }
    if (failures.length > 0) setError(`Falha em ${failures.length} email(s): ${failures[0]}`);
    if (!emailIdsOverride || targetIds.every((id) => selectedEmailIds.includes(id))) setSelectedEmailIds((current) => current.filter((id) => !targetIds.includes(id)));
    if (action === "move") setBulkMoveTarget("");
    setBulkActioning(false);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditing = !!target && (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT");
      if (event.key === "/" && !isEditing) { event.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select(); return; }
      if (isEditing) { if (event.key === "Escape" && tag === "INPUT") (target as HTMLInputElement).blur(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && filteredEmails.length) { event.preventDefault(); toggleSelectAllVisible(true); return; }
      if ((event.key === "ArrowDown" || event.key.toLowerCase() === "j") && filteredEmails.length) { event.preventDefault(); moveSelection(1); return; }
      if ((event.key === "ArrowUp" || event.key.toLowerCase() === "k") && filteredEmails.length) { event.preventDefault(); moveSelection(-1); return; }
      if (event.key.toLowerCase() === "x" && selectedEmail) { event.preventDefault(); toggleEmailSelection(selectedEmail.id); return; }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); void refreshAll(selectedMailboxId || undefined); return; }
      if (event.key.toLowerCase() === "u" && selectedEmail && canWriteSelected) { event.preventDefault(); void applyEmailAction(selectedEmail.id, selectedEmail.is_seen ? "mark_unread" : "mark_read"); return; }
      if (event.key.toLowerCase() === "f" && selectedEmail && canWriteSelected) { event.preventDefault(); void applyEmailAction(selectedEmail.id, selectedEmail.is_flagged ? "unflag" : "flag"); return; }
      if (event.key === "Delete") {
        if (selectedEmailIds.length > 1 && bulkCanWrite) { event.preventDefault(); void applyBulkAction("delete"); return; }
        if (selectedEmail && canWriteSelected) { event.preventDefault(); void applyEmailAction(selectedEmail.id, "delete"); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bulkCanWrite, canWriteSelected, filteredEmails, selectedEmail, selectedEmailId, selectedEmailIds, selectedMailboxId]);

  // ─── RENDER ───────────────────────────────────────────────────────────────────

  // Compose Modal rendered as overlay
  const composeModal = composeMode && selectedEmail ? (
    <div className="compose-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !composeSending) closeCompose(); }}>
      <div className="compose-modal">
        <div className="compose-modal-header">
          <div className="compose-modal-header-left">
            <span className="compose-modal-icon">
              {composeMode === "reply" ? "↩" : composeMode === "reply_all" ? "↩↩" : "↪"}
            </span>
            <span className="compose-modal-title">
              {composeMode === "reply" ? "Responder" : composeMode === "reply_all" ? "Responder a todos" : "Reencaminhar"}
            </span>
          </div>
          <button className="compose-modal-close" onClick={closeCompose} disabled={composeSending} type="button" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="compose-modal-body">
          <div className="compose-modal-from">
            <span className="compose-modal-from-label">De:</span>
            <span className="compose-modal-from-value">{selectedMailbox?.email_address || "—"}</span>
          </div>

          <div className="compose-modal-fields">
            <div className="compose-modal-field">
              <label className="compose-modal-label">Para:</label>
              <input
                type="text"
                className="compose-modal-input"
                value={composeTo}
                onChange={e => setComposeTo(e.target.value)}
                placeholder="destinatario@email.com"
                autoFocus={composeMode === "forward"}
              />
            </div>
            <div className="compose-modal-field">
              <label className="compose-modal-label">Cc:</label>
              <input
                type="text"
                className="compose-modal-input"
                value={composeCc}
                onChange={e => setComposeCc(e.target.value)}
                placeholder="cc@email.com (opcional)"
              />
            </div>
            <div className="compose-modal-field">
              <label className="compose-modal-label">Assunto:</label>
              <input
                type="text"
                className="compose-modal-input compose-modal-input-subject"
                value={composeSubject}
                onChange={e => setComposeSubject(e.target.value)}
              />
            </div>
          </div>

          <div className="compose-modal-editor">
            <textarea
              ref={composeBodyRef}
              className="compose-modal-textarea"
              value={composeBody}
              onChange={e => setComposeBody(e.target.value)}
              placeholder="Escreva a sua mensagem..."
            />
          </div>

          {composeAttachments.length > 0 && (
            <div className="compose-attachments-list">
              <div className="compose-attachments-header">
                <span>📎 Anexos ({composeAttachments.length})</span>
                <span className="compose-attachments-size">
                  {(composeAttachments.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
              <div className="compose-attachments-items">
                {composeAttachments.map((file, idx) => (
                  <div key={`${file.name}-${idx}`} className="compose-attachment-item">
                    <span className="compose-attachment-icon">
                      {file.type.startsWith("image/") ? "🖼️" : file.type.includes("pdf") ? "📄" : file.type.includes("word") || file.type.includes("document") ? "📝" : file.type.includes("sheet") || file.type.includes("excel") ? "📊" : "📁"}
                    </span>
                    <span className="compose-attachment-name" title={file.name}>{file.name}</span>
                    <span className="compose-attachment-size">{file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / 1048576).toFixed(1)} MB`}</span>
                    <button
                      className="compose-attachment-remove"
                      onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== idx))}
                      type="button"
                      title="Remover anexo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <input
          ref={composeFileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
              const totalSize = [...composeAttachments, ...files].reduce((sum, f) => sum + f.size, 0);
              if (totalSize > 25 * 1024 * 1024) {
                setError("O tamanho total dos anexos não pode exceder 25 MB.");
                return;
              }
              setComposeAttachments(prev => [...prev, ...files]);
            }
            if (composeFileInputRef.current) composeFileInputRef.current.value = "";
          }}
        />

        <div className="compose-modal-footer">
          <div className="compose-modal-footer-left">
            <button
              className="compose-modal-btn-send"
              onClick={() => void handleSendReply()}
              disabled={composeSending || !composeTo.trim()}
              type="button"
            >
              {composeSending ? (
                <><span className="compose-modal-spinner" /> A enviar...</>
              ) : (
                <>✉ Enviar</>  
              )}
            </button>
            <button
              className="compose-modal-btn-attach"
              onClick={() => composeFileInputRef.current?.click()}
              disabled={composeSending}
              type="button"
              title="Anexar ficheiro"
            >
              📎 Anexar
            </button>
          </div>
          <div className="compose-modal-footer-right">
            <button
              className="compose-modal-btn-cancel"
              onClick={closeCompose}
              disabled={composeSending}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
    <main ref={shellRef} className={`shell${isFullscreen ? " fullscreen" : ""}`}>
      {/* Compact Header Bar */}
      <div className="mail-header-bar">
        <div className="mail-header-left">
          <span className="mail-header-title">✉️ Email</span>
          <div className="mail-header-stats">
            <span><span className="stat-value">{summary.unread_emails ?? 0}</span> por ler</span>
            <span><span className="stat-value">{summary.stored_emails ?? 0}</span> guardados</span>
            <span><span className="stat-value">{summary.connected_mailboxes ?? 0}</span> caixas</span>
          </div>
        </div>
        <div className="mail-header-right">
          {selectedMailbox ? (
            <>
              <span className={statusClass(selectedMailbox.status)}>{mailboxStatusLabel(selectedMailbox.status)}</span>
              <button
                className="admin-button secondary"
                onClick={() => void syncMailbox(selectedMailbox.id)}
                disabled={selectedMailboxIsSyncing || !selectedMailbox.sync_enabled}
                type="button"
              >
                {selectedMailboxIsSyncing ? "A sincronizar..." : "Sincronizar"}
              </button>
            </>
          ) : null}
          <button className="admin-button secondary" type="button" onClick={() => void refreshAll(selectedMailboxId || undefined)} disabled={mailLoading || foldersLoading || loading}>
            Atualizar
          </button>
          <button
            className="admin-button secondary fullscreen-toggle"
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair de ecrã inteiro" : "Ecrã inteiro"}
          >
            {isFullscreen ? "⊡" : "⊞"}
          </button>
        </div>
      </div>

      {/* Compact Toolbar */}
      <div className="mail-toolbar-compact">
        <label className="mail-search" aria-label="Pesquisar emails">
          <span className="mail-search-icon">⌕</span>
          <input
            ref={searchInputRef}
            className="mail-search-input"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Pesquisar..."
          />
        </label>
        <div className="toolbar-divider" />
        <button className={`toolbar-chip ${activeQuickCategory === "all" ? "active" : ""}`} onClick={() => setExclusiveFilter("all")} type="button">
          Tudo
        </button>
        <button className={`toolbar-chip ${activeQuickCategory === "unread" ? "active" : ""}`} onClick={() => setExclusiveFilter("unread")} type="button">
          Não lidos ({unreadCount})
        </button>
        <button className={`toolbar-chip ${activeQuickCategory === "flagged" ? "active" : ""}`} onClick={() => setExclusiveFilter("flagged")} type="button">
          Importantes ({flaggedCount})
        </button>
        <button className={`toolbar-chip ${activeQuickCategory === "attachments" ? "active" : ""}`} onClick={() => setExclusiveFilter("attachments")} type="button">
          Anexos ({attachmentsCount})
        </button>
        {activeFilterCount > 0 ? (
          <button className="toolbar-chip" type="button" onClick={() => { setSearchQuery(""); setShowUnreadOnly(false); setShowAttachmentsOnly(false); setShowFlaggedOnly(false); }}>
            Limpar
          </button>
        ) : null}
      </div>

      {/* Notifications */}
      {error ? (
        <div className="notification-bar error">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>×</button>
        </div>
      ) : null}
      {success ? (
        <div className="notification-bar success">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess("")}>×</button>
        </div>
      ) : null}

      {/* Main Mail Layout */}
      <div className="mail-app-card">
        {loading ? (
          <div className="empty">A preparar o cliente de email...</div>
        ) : mailboxes.length === 0 ? (
          <div className="empty">Ainda não existem mailboxes IMAP configuradas.</div>
        ) : (
          <div className="mail-layout" style={mailLayoutStyle}>
            {/* Sidebar */}
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
                      onClick={() => { setSelectedFolder(inboxFolder); setExclusiveFilter("all"); }}
                      onDragOver={(event) => handleFolderDragOver(event, inboxFolder)}
                      onDragLeave={() => handleFolderDragLeave(inboxFolder)}
                      onDrop={(event) => { event.preventDefault(); void handleFolderDrop(inboxFolder); }}
                      type="button"
                    >
                      <span className="favorite-main"><span aria-hidden="true">📥</span><span>Entrada</span></span>
                      <span className="favorite-count">{inboxStats?.unread ?? 0}</span>
                    </button>
                    <button className={`favorite-button ${activeQuickCategory === "flagged" ? "active" : ""}`} onClick={() => { setSelectedFolder(ALL_FOLDERS_KEY); setExclusiveFilter("flagged"); }} type="button">
                      <span className="favorite-main"><span aria-hidden="true">⭐</span><span>Importantes</span></span>
                      <span className="favorite-count">{flaggedCount}</span>
                    </button>
                    <button className={`favorite-button ${activeQuickCategory === "unread" ? "active" : ""}`} onClick={() => { setSelectedFolder(ALL_FOLDERS_KEY); setExclusiveFilter("unread"); }} type="button">
                      <span className="favorite-main"><span aria-hidden="true">👁</span><span>Não lidos</span></span>
                      <span className="favorite-count">{unreadCount}</span>
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
                  <div className="mailbox-list">
                    {mailboxes.map((item) => (
                      <button key={item.id} className={`mailbox-button ${selectedMailboxId === item.id ? "active" : ""}`} onClick={() => setSelectedMailboxId(item.id)} type="button">
                        <div>
                          <div className="mailbox-button-title">{item.name}</div>
                          <div className="mailbox-button-subtitle">{item.email_address}</div>
                          <div className="mailbox-button-counters">
                            <span>{item.unread_count ?? 0} por ler</span>
                            <span>{item.stored_count ?? 0} total</span>
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
                    <div className="folder-list">
                      <button className={`folder-button ${selectedFolder === ALL_FOLDERS_KEY ? "active" : ""}`} onClick={() => setSelectedFolder(ALL_FOLDERS_KEY)} type="button">
                        <span className="folder-main"><span className="folder-icon" aria-hidden="true">{getFolderMeta(ALL_FOLDERS_KEY).icon}</span><span className="folder-name">Todas</span></span>
                        <span className="folder-badges">
                          {totalUnreadForMailbox > 0 ? <span className="folder-unread-badge">{totalUnreadForMailbox}</span> : null}
                          <span className="folder-count">{totalStoredForMailbox}</span>
                        </span>
                      </button>
                      {groupedFolders.map((entry) => {
                        if ("children" in entry) {
                          // This is a folder group with sub-folders
                          const group = entry as { parent: FolderStat; children: FolderStat[] };
                          const parentMeta = getFolderMeta(group.parent.folder);
                          const parentVisibleStats = group.parent.folder === inboxFolder && inboxStats ? inboxStats : group.parent;
                          const groupKey = trimInboxRoot(splitFolderSegments(group.parent.folder))[0] || group.parent.folder;
                          const isGroupCollapsed = collapsedFolderGroups[groupKey] !== false; // collapsed by default
                          const groupTotalUnread = group.children.reduce((sum, c) => sum + c.unread, 0) + group.parent.unread;
                          const groupTotalStored = group.children.reduce((sum, c) => sum + c.stored, 0) + group.parent.stored;
                          return (
                            <div key={group.parent.folder} className="folder-group">
                              <button
                                className={`folder-button folder-group-header ${selectedFolder === group.parent.folder ? "active" : ""}`}
                                onClick={() => setSelectedFolder(group.parent.folder)}
                                onDragOver={(event) => handleFolderDragOver(event, group.parent.folder, groupKey)}
                                onDragLeave={() => handleFolderDragLeave(group.parent.folder)}
                                onDrop={(event) => { event.preventDefault(); void handleFolderDrop(group.parent.folder); }}
                                title={group.parent.folder}
                                type="button"
                              >
                                <span className="folder-main">
                                  <span className="folder-expand-toggle" onClick={(e) => { e.stopPropagation(); toggleFolderGroup(groupKey); }} role="button" tabIndex={0}>
                                    {isGroupCollapsed ? "▸" : "▾"}
                                  </span>
                                  <span className="folder-icon" aria-hidden="true">{parentMeta.icon}</span>
                                  <span className="folder-name">{parentMeta.label}</span>
                                </span>
                                <span className="folder-badges">
                                  {groupTotalUnread > 0 ? <span className="folder-unread-badge">{groupTotalUnread}</span> : null}
                                  <span className="folder-count">{groupTotalStored}</span>
                                </span>
                              </button>
                              {!isGroupCollapsed && group.children.map((child) => {
                                const childMeta = getFolderMeta(child.folder);
                                const childVisibleStats = child.folder === inboxFolder && inboxStats ? inboxStats : child;
                                // Show only the last segment for sub-folders
                                const childSegments = trimInboxRoot(splitFolderSegments(child.folder));
                                const childLabel = childSegments.length > 1 ? childSegments.slice(1).map(s => prettifyFolderSegment(s)).join(" / ") : childMeta.label;
                                return (
                                  <button
                                    key={child.folder}
                                    className={`folder-button folder-child ${selectedFolder === child.folder ? "active" : ""} ${dragHoverFolder === child.folder ? "drag-target" : ""}`}
                                    onClick={() => setSelectedFolder(child.folder)}
                                    onDragOver={(event) => handleFolderDragOver(event, child.folder)}
                                    onDragLeave={() => handleFolderDragLeave(child.folder)}
                                    onDrop={(event) => { event.preventDefault(); void handleFolderDrop(child.folder); }}
                                    title={child.folder}
                                    type="button"
                                  >
                                    <span className="folder-main"><span className="folder-icon" aria-hidden="true">{childMeta.icon}</span><span className="folder-name">{childLabel}</span></span>
                                    <span className="folder-badges">
                                      {childVisibleStats.unread > 0 ? <span className="folder-unread-badge">{childVisibleStats.unread}</span> : null}
                                      <span className="folder-count">{childVisibleStats.stored}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        } else {
                          // Single folder without children
                          const item = entry as FolderStat;
                          const meta = getFolderMeta(item.folder);
                          const visibleStats = item.folder === inboxFolder && inboxStats ? inboxStats : item;
                          return (
                            <button
                              key={item.folder}
                              className={`folder-button ${selectedFolder === item.folder ? "active" : ""} ${dragHoverFolder === item.folder ? "drag-target" : ""}`}
                              onClick={() => setSelectedFolder(item.folder)}
                              onDragOver={(event) => handleFolderDragOver(event, item.folder)}
                              onDragLeave={() => handleFolderDragLeave(item.folder)}
                              onDrop={(event) => { event.preventDefault(); void handleFolderDrop(item.folder); }}
                              title={item.folder}
                              type="button"
                            >
                              <span className="folder-main"><span className="folder-icon" aria-hidden="true">{meta.icon}</span><span className="folder-name">{meta.label}</span></span>
                              <span className="folder-badges">
                                {visibleStats.unread > 0 ? <span className="folder-unread-badge">{visibleStats.unread}</span> : null}
                                <span className="folder-count">{visibleStats.stored}</span>
                              </span>
                            </button>
                          );
                        }
                      })}
                      {!folderStats.length && !foldersLoading ? <div className="empty compact">Sem pastas sincronizadas.</div> : null}
                    </div>
                  ) : (
                    <div className="empty compact">Selecione uma mailbox.</div>
                  )
                ) : null}
              </div>
            </aside>

            <div className="mail-resizer" onMouseDown={(event) => startResize("sidebar", event)} role="separator" aria-orientation="vertical" />

            {/* Mail List */}
            <section className="mail-list-column">
              <div className="mail-column-header">
                <div>
                  <h3>{selectedFolderMeta.icon} {folderSelectionLabel}</h3>
                  <p>{mailLoading ? "A carregar..." : `${filteredEmails.length} email(s)`}</p>
                </div>
                <div className="mail-column-actions">
                  <button className="toolbar-chip small" type="button" onClick={() => toggleSelectAllVisible()} disabled={!filteredEmails.length}>
                    {allVisibleSelected ? "Limpar" : "Selecionar"}
                  </button>
                </div>
              </div>

              {selectedEmailIds.length > 0 ? (
                <div className="bulk-action-bar">
                  <div className="bulk-action-summary">{selectedEmailIds.length} selecionados</div>
                  <div className="bulk-action-controls">
                    <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("mark_read")} disabled={!bulkCanWrite || bulkActioning}>Lidos</button>
                    <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("mark_unread")} disabled={!bulkCanWrite || bulkActioning}>Por ler</button>
                    <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("flag")} disabled={!bulkCanWrite || bulkActioning}>★</button>
                    <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("unflag")} disabled={!bulkCanWrite || bulkActioning}>☆</button>
                    <select className="bulk-select" value={bulkMoveTarget} onChange={(event) => setBulkMoveTarget(event.target.value)} disabled={!bulkCanWrite || bulkActioning}>
                      <option value="">Mover...</option>
                      {folderOptions.map((folder) => (<option key={`bulk-${folder}`} value={folder}>{folderLabel(folder)}</option>))}
                    </select>
                    <button className="toolbar-chip small" type="button" onClick={() => void applyBulkAction("move", bulkMoveTarget)} disabled={!bulkCanMove || bulkActioning}>Mover</button>
                    <button className="toolbar-chip small danger" type="button" onClick={() => void applyBulkAction("delete")} disabled={!bulkCanWrite || bulkActioning}>Apagar</button>
                  </div>
                </div>
              ) : null}

              {mailLoading ? (
                <div className="empty">A carregar emails...</div>
              ) : filteredEmails.length === 0 ? (
                <div className="empty">Sem emails nesta seleção.</div>
              ) : (
                <div className="compact-mail-list" ref={mailListRef}>
                  <div className="mail-list">
                    {filteredEmails.map((item) => {
                      const canWriteRow = !!selectedMailbox && selectedMailbox.access_mode === "read_write" && !item.remote_deleted;
                      return (
                        <div
                          key={item.id}
                          className={`mail-row ${selectedEmailId === item.id ? "active" : ""} ${item.is_seen ? "" : "unread"}`}
                          onClick={() => setSelectedEmailId(item.id)}
                          onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                          onDragStart={(event) => { if (!canWriteRow) return; setDraggingEmailId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
                          onDragEnd={() => { setDraggingEmailId(""); setDragHoverFolder(""); }}
                          draggable={canWriteRow}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="mail-row-status-dot" aria-hidden="true" />
                          <label className="mail-row-check" onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" checked={selectedEmailIds.includes(item.id)} onChange={(event) => toggleEmailSelection(item.id, event.target.checked)} />
                          </label>
                          <div className="mail-row-avatar" aria-hidden="true">{senderInitial(item)}</div>
                          <div className="mail-row-main">
                            <div className="mail-row-top">
                              <span className="mail-row-sender">{displaySender(item)}</span>
                              <div className="mail-row-header-actions">
                                <button
                                  className={`mail-row-star-button ${item.is_flagged ? "active" : ""}`}
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); if (!canWriteRow || actioningEmailId === item.id) return; void applyEmailAction(item.id, item.is_flagged ? "unflag" : "flag"); }}
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
                                {item.has_attachments ? <span className="mini-badge">📎</span> : null}
                                {!item.is_seen ? <span className="mini-badge unread">Novo</span> : null}
                              </span>
                            </div>
                            <div className="mail-row-snippet">{item.snippet || ""}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <div className="mail-resizer" onMouseDown={(event) => startResize("list", event)} role="separator" aria-orientation="vertical" />

            {/* Mail Reader */}
            <section className="mail-reader">
              {!selectedEmail ? (
                <div className="reader-empty">Selecione um email para ler.</div>
              ) : (
                <>
                  <div className="reader-shell">
                    <div className="reader-header-card">
                      <div className="reader-persona">
                        <div className="reader-avatar" aria-hidden="true">{senderInitial(selectedEmail)}</div>
                        <div>
                          <h3>{selectedEmail.subject || "(Sem assunto)"}</h3>
                          <p><strong>De:</strong> {displaySender(selectedEmail)}</p>
                          <p><strong>Para:</strong> {selectedEmail.to_addresses || "—"}</p>
                          <p><strong>Data:</strong> {formatLongDate(selectedEmail.received_at)}</p>
                        </div>
                      </div>
                      <div className="meta" style={{ marginTop: "8px" }}>
                        <span className="tag">{selectedEmailFolderMeta.icon} {folderLabel(selectedEmail.folder || "INBOX")}</span>
                        <span className="tag">{selectedMailbox ? mailboxAccessLabel(selectedMailbox.access_mode) : "Só leitura"}</span>
                        {selectedEmail.is_flagged ? <span className="tag important">★ Importante</span> : null}
                        {selectedEmail.has_attachments ? <span className="tag">📎 Anexos</span> : null}
                      </div>
                    </div>

                    <div className="reader-ribbon">
                      <div className="reader-ribbon-title">Ações</div>
                      <div className="mail-reader-actions">
                        <button className={`admin-button secondary ${selectedEmail.is_flagged ? "active-toggle" : ""}`} disabled={!canWriteSelected || actioningEmailId === selectedEmail.id} onClick={() => void applyEmailAction(selectedEmail.id, selectedEmail.is_flagged ? "unflag" : "flag")} type="button">
                          {selectedEmail.is_flagged ? "☆ Remover" : "★ Importante"}
                        </button>
                        <button className="admin-button secondary" disabled={!canWriteSelected || actioningEmailId === selectedEmail.id || selectedEmail.is_seen} onClick={() => void applyEmailAction(selectedEmail.id, "mark_read")} type="button">Marcar lido</button>
                        <button className="admin-button secondary" disabled={!canWriteSelected || actioningEmailId === selectedEmail.id || !selectedEmail.is_seen} onClick={() => void applyEmailAction(selectedEmail.id, "mark_unread")} type="button">Marcar por ler</button>
                        <select className="admin-input" value={selectedMoveTarget} onChange={(event) => setMoveTargetByEmail((current) => ({ ...current, [selectedEmail.id]: event.target.value }))} disabled={!canWriteSelected} style={{ maxWidth: "140px" }}>
                          <option value="">Mover para...</option>
                          {folderOptions.map((folder) => (<option key={`${selectedEmail.id}-${folder}`} value={folder}>{folderLabel(folder)}</option>))}
                        </select>
                        <button className="admin-button secondary" disabled={!canMoveSelected || actioningEmailId === selectedEmail.id || foldersLoading} onClick={() => void applyEmailAction(selectedEmail.id, "move", selectedMoveTarget)} type="button">Mover</button>
                        <button className="admin-button danger" disabled={!canWriteSelected || actioningEmailId === selectedEmail.id} onClick={() => void applyEmailAction(selectedEmail.id, "delete")} type="button">Apagar</button>
                      </div>
                    </div>
                    <div className="reader-ribbon">
                      <div className="reader-ribbon-title">Responder</div>
                      <div className="mail-reader-actions">
                        <button className="admin-button primary" disabled={!canWriteSelected} onClick={() => openCompose("reply")} type="button">↩ Responder</button>
                        <button className="admin-button secondary" disabled={!canWriteSelected} onClick={() => openCompose("reply_all")} type="button">↩↩ Responder a todos</button>
                        <button className="admin-button secondary" disabled={!canWriteSelected} onClick={() => openCompose("forward")} type="button">↪ Reencaminhar</button>
                      </div>
                    </div>
                  </div>

                  {selectedMailbox && selectedMailbox.access_mode !== "read_write" ? (
                    <p className="footer-note">Mailbox em modo só de leitura.</p>
                  ) : null}

                  {(attachmentsLoading || attachments.length > 0) && (
                    <div className="reader-attachments">
                      <div className="attachments-header">
                        <button className="attachments-toggle" onClick={() => setAttachmentsExpanded(e => !e)} type="button">
                          📎 {attachmentsLoading ? "A carregar anexos..." : `${attachments.length} anexo(s)`}
                          <span>{attachmentsExpanded ? "▾" : "▸"}</span>
                        </button>
                        {!attachmentsLoading && attachments.length > 0 && (
                          <button className="btn-preview-attachments" onClick={() => { setPreviewIndex(0); setPreviewOpen(true); }} type="button">
                            👁 Visualizar
                          </button>
                        )}
                      </div>
                      {attachmentsExpanded && !attachmentsLoading && (
                        <div className="attachments-list">
                          {attachments.map(att => (
                            <a key={att.index} className="attachment-item"
                              href={`${API_BASE}/api/emails/${selectedEmail!.id}/attachments/${att.index}?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`}
                              target="_blank" rel="noreferrer"
                              download={att.filename}>
                              <span className="att-icon">{att.content_type.startsWith("image/") ? "🖼️" : (att.content_type.includes("pdf") || att.filename.match(/\.pdf$/i)) ? "📄" : "📎"}</span>
                              <span className="att-name">{att.filename}</span>
                              <span className="att-size">{att.size > 1024*1024 ? `${(att.size/1024/1024).toFixed(1)} MB` : `${Math.round(att.size/1024)} KB`}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview Modal */}
                  {previewOpen && attachments.length > 0 && (
                    <div className="attachment-preview-overlay" onClick={() => setPreviewOpen(false)}>
                      <div className="attachment-preview-modal" onClick={e => e.stopPropagation()}>
                        <div className="preview-modal-header">
                          <span className="preview-modal-title">
                            {attachments[previewIndex]?.filename} ({previewIndex + 1}/{attachments.length})
                          </span>
                          <button className="preview-modal-close" onClick={() => setPreviewOpen(false)} type="button">✕</button>
                        </div>
                        <div className="preview-modal-body">
                          {previewIndex > 0 && (
                            <button className="preview-nav preview-nav-left" onClick={() => setPreviewIndex(i => i - 1)} type="button">❮</button>
                          )}
                          <div className="preview-content" key={`preview-${previewIndex}-${attachments[previewIndex]?.index}`}>
                            {previewLoading && (
                              <div className="preview-loading-overlay">
                                <div className="preview-spinner" />
                                <span className="preview-loading-text">A carregar...</span>
                              </div>
                            )}
                            {(() => {
                              const att = attachments[previewIndex];
                              const url = `${API_BASE}/api/emails/${selectedEmail!.id}/attachments/${att.index}?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`;
                              const markLoaded = () => {
                                const cacheKey = `${selectedEmail!.id}-${att.index}`;
                                previewCacheRef.current[cacheKey] = "loaded";
                                setPreviewLoading(false);
                              };
                              if (att.content_type.startsWith("image/")) {
                                return <img src={url} alt={att.filename} className="preview-image" onLoad={markLoaded} onError={markLoaded} style={previewLoading ? {opacity: 0} : {opacity: 1, transition: 'opacity 0.2s'}} />;
                              } else if (att.content_type.includes("pdf") || att.filename.match(/\.pdf$/i)) {
                                const pdfPreviewUrl = `${API_BASE}/api/emails/${selectedEmail!.id}/attachments/${att.index}/preview?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`;
                                return <iframe src={pdfPreviewUrl} className="preview-iframe" title={att.filename} onLoad={markLoaded} style={previewLoading ? {opacity: 0} : {opacity: 1, transition: 'opacity 0.2s'}} />;
                              } else if (att.content_type.includes("word") || att.content_type.includes("document") || att.filename.match(/\.docx?$/i) || att.content_type.includes("spreadsheet") || att.content_type.includes("excel") || att.filename.match(/\.xlsx?$/i) || att.content_type.includes("presentation") || att.filename.match(/\.pptx?$/i)) {
                                // Use server-side preview endpoint (converts to HTML)
                                const previewUrl = `${API_BASE}/api/emails/${selectedEmail!.id}/attachments/${att.index}/preview?${new URLSearchParams(Object.entries(buildHeaders(tenantId))).toString()}`;
                                return (
                                  <div className="preview-office-wrapper" style={previewLoading ? {opacity: 0} : {opacity: 1, transition: 'opacity 0.2s'}}>
                                    <iframe src={previewUrl} className="preview-iframe" title={att.filename} onLoad={markLoaded} />
                                    <div className="preview-office-fallback">
                                      <span>{att.filename} — {att.size > 1024*1024 ? `${(att.size/1024/1024).toFixed(1)} MB` : `${Math.round(att.size/1024)} KB`}</span>
                                      <a href={url} download={att.filename} className="preview-download-btn-sm">⬇ Descarregar</a>
                                    </div>
                                  </div>
                                );
                              } else {
                                // Generic file - no loading needed, show immediately
                                if (previewLoading) setTimeout(() => setPreviewLoading(false), 100);
                                return (
                                  <div className="preview-file-info">
                                    <div className="preview-file-icon">📎</div>
                                    <div className="preview-file-name">{att.filename}</div>
                                    <div className="preview-file-size">{att.size > 1024*1024 ? `${(att.size/1024/1024).toFixed(1)} MB` : `${Math.round(att.size/1024)} KB`}</div>
                                    <a href={url} download={att.filename} className="preview-download-btn">⬇ Descarregar</a>
                                  </div>
                                );
                              }
                            })()}
                          </div>
                          {previewIndex < attachments.length - 1 && (
                            <button className="preview-nav preview-nav-right" onClick={() => setPreviewIndex(i => i + 1)} type="button">❯</button>
                          )}
                        </div>
                        <div className="preview-modal-footer">
                          <div className="preview-dots">
                            {attachments.map((_, i) => (
                              <button key={i} className={`preview-dot ${i === previewIndex ? "active" : ""}`} onClick={() => setPreviewIndex(i)} type="button" />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}



                  <div className="mail-reader-body">
                    {selectedEmail.body_text?.trim()
                      ? selectedEmail.body_text
                      : selectedEmail.snippet || "Sem conteúdo sincronizado."}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
    {composeModal}
    </>  
  );
}
