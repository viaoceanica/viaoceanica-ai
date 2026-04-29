"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "/module/contabilidade/api-proxy";

type TabKey = "upload" | "queue" | "search";
type UploadStep = "validate" | "extract" | "review" | "save";
type HealthLevel = "checking" | "ok" | "warn" | "down";

type QueueSort =
  | "created_desc"
  | "created_asc"
  | "confidence_asc"
  | "confidence_desc"
  | "total_desc"
  | "vendor_asc";

interface InvoiceLineItem {
  id: string;
  code?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  line_subtotal?: number | string | null;
  line_tax_amount?: number | string | null;
  line_total?: number | string | null;
  tax_rate?: number | string | null;
  tax_rate_source?: string | null;
  review_reason?: string | null;
}

interface Invoice {
  id: string;
  tenant_id: string;
  filename: string;
  duplicate_candidate_invoice_id?: string | null;
  vendor?: string | null;
  vendor_address?: string | null;
  vendor_contact?: string | null;
  category?: string | null;
  subtotal?: number | string | null;
  tax?: number | string | null;
  total?: number | string | null;
  currency?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  supplier_nif?: string | null;
  customer_name?: string | null;
  customer_nif?: string | null;
  token_input?: number | null;
  token_output?: number | null;
  token_total?: number | null;
  confidence_score?: number | string | null;
  requires_review?: boolean;
  notes?: string | null;
  line_items?: InvoiceLineItem[];
  status: string;
  created_at: string;
}

interface FailedImportRow {
  id: string;
  tenant_id: string;
  filename: string;
  mime_type?: string | null;
  file_size?: number | null;
  reason: string;
  detected_type?: string | null;
  source: string;
  retry_count: number;
  last_retry_at?: string | null;
  created_at: string;
}

interface RejectedUploadRow {
  filename: string;
  reason: string;
  detected_type?: string | null;
}

interface UploadInboxRow {
  kind: "invoice" | "rejected";
  id: string;
  filename: string;
  statusLabel: string;
  statusTone: "success" | "warn" | "error";
  reason?: string;
  detectedType?: string | null;
  vendor?: string | null;
  createdAt?: string;
  invoice?: Invoice;
}

interface DuplicateReviewState {
  uploaded: Invoice;
  existingId: string;
}

interface ReviewLineItem {
  invoice_id: string;
  invoice_number?: string | null;
  vendor?: string | null;
  filename: string;
  created_at: string;
  line_item_id: string;
  position?: number | string | null;
  description?: string | null;
  line_total?: number | string | null;
  tax_rate?: number | string | null;
  tax_rate_source?: string | null;
  normalization_confidence?: number | string | null;
  review_reason?: string | null;
}

interface AutomationBlocker {
  invoice_id: string;
  invoice_number?: string | null;
  filename: string;
  vendor?: string | null;
  code: string;
  severity: string;
  message: string;
  created_at: string;
}

interface TenantProfile {
  company_name?: string | null;
  company_nif?: string | null;
}

interface ChatReference {
  invoice_id: string;
  vendor?: string | null;
  invoice_number?: string | null;
  score?: number | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  references?: ChatReference[];
}

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface UploadTelemetry {
  started: number;
  completed: number;
  failed: number;
  stepHits: Record<UploadStep, number>;
}

interface UploadFunnelStepServer {
  step: UploadStep;
  enter: number;
  success: number;
  failure: number;
}

interface UploadFunnelResponseServer {
  tenant_id: string;
  total_events: number;
  steps: UploadFunnelStepServer[];
  generated_at: string;
}

interface SystemHealth {
  api: HealthLevel;
  db: HealthLevel;
  ocr: HealthLevel;
  ocrDetail: string;
  lastChecked: string | null;
}

interface EditableInvoiceForm {
  vendor: string;
  category: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  supplier_nif: string;
  customer_name: string;
  customer_nif: string;
  subtotal: string;
  tax: string;
  total: string;
  notes: string;
}

interface EditableInvoiceLineItem {
  id?: string;
  code: string;
  description: string;
  quantity: string;
  unit_price: string;
  line_subtotal: string;
  line_tax_amount: string;
  line_total: string;
  tax_rate: string;
}

const UPLOAD_STEPS: UploadStep[] = ["validate", "extract", "review", "save"];
const TELEMETRY_KEY = "viacontab.uploadTelemetry.v1";

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const emptyForm = (): EditableInvoiceForm => ({
  vendor: "",
  category: "",
  invoice_number: "",
  invoice_date: "",
  due_date: "",
  supplier_nif: "",
  customer_name: "",
  customer_nif: "",
  subtotal: "",
  tax: "",
  total: "",
  notes: "",
});

const emptyServerFunnel = (): Record<UploadStep, { enter: number; success: number; failure: number }> => ({
  validate: { enter: 0, success: 0, failure: 0 },
  extract: { enter: 0, success: 0, failure: 0 },
  review: { enter: 0, success: 0, failure: 0 },
  save: { enter: 0, success: 0, failure: 0 },
});

const createEmptyEditableLineItem = (): EditableInvoiceLineItem => ({
  code: "",
  description: "",
  quantity: "",
  unit_price: "",
  line_subtotal: "",
  line_tax_amount: "",
  line_total: "",
  tax_rate: "",
});

function toEditableLineItem(item: InvoiceLineItem): EditableInvoiceLineItem {
  return {
    id: item.id,
    code: item.code ?? "",
    description: item.description ?? "",
    quantity: toPtNumberString(item.quantity),
    unit_price: toPtNumberString(item.unit_price),
    line_subtotal: toPtNumberString(item.line_subtotal),
    line_tax_amount: toPtNumberString(item.line_tax_amount),
    line_total: toPtNumberString(item.line_total),
    tax_rate: toPtNumberString(item.tax_rate),
  };
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

function formatMoney(value: number | string | null | undefined, currency = "EUR") {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-PT");
}

function toPtDate(value: string | null | undefined) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function toIsoDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slash = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return trimmed;
}

function toPtNumberString(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
    useGrouping: false,
  }).format(num);
}

function parsePtNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function invoiceQueueState(row: Invoice): "review" | "processed" | "error" {
  const status = (row.status || "").toLowerCase();
  if (status.includes("error") || status.includes("reject") || status.includes("timeout")) return "error";
  if (row.requires_review || status.includes("revis") || status.includes("review")) return "review";
  return "processed";
}

function guidanceForError(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("tenant")) return "Defina um tenant válido antes de continuar.";
  if (lowered.includes("selecione") || lowered.includes("adicione pelo menos um")) return "Adicione pelo menos um PDF/JPG/PNG e tente novamente.";
  if (lowered.includes("502 bad gateway") || lowered.includes("bad gateway")) {
    return "O serviço demorou demasiado tempo a responder. O sistema pode estar a processar o ficheiro ou ter excedido o tempo limite.";
  }
  if (lowered.includes("tempo limite") || lowered.includes("processing_timeout") || lowered.includes("timeout ao processar")) {
    return "O processamento demorou demasiado tempo e foi interrompido. Tente novamente ou use um ficheiro mais leve/legível.";
  }
  if (lowered.includes("socket hang up") || lowered.includes("econnreset")) {
    return "A ligação ao serviço de ingestão foi interrompida durante o upload. Tente novamente. Se repetir, o backend precisa de inspeção neste ficheiro.";
  }
  if (lowered.includes("network") || lowered.includes("failed to fetch")) {
    return "Confirme backend ativo e ligação entre frontend e backend.";
  }
  if (lowered.includes("zip")) return "Verifique ZIP (máx 200 ficheiros, 20MB por ficheiro, 100MB total).";
  if (lowered.includes("não como fatura") || lowered.includes("não foi possível confirmar")) {
    return "Confirme que o ficheiro é mesmo uma fatura legível, com número, fornecedor/NIF e totais visíveis.";
  }
  if (lowered.includes("recibo simples")) return "Se quiser processar recibos, teremos de ajustar as regras de validação.";
  if (lowered.includes("tempo limite")) return "Tente um PDF mais pequeno, menos páginas, ou uma imagem mais nítida.";
  return "Revise os campos destacados e tente novamente.";
}

function getStageLabel(step: UploadStep) {
  if (step === "validate") return "Validar";
  if (step === "extract") return "Extrair";
  if (step === "review") return "Rever";
  return "Guardar";
}

export default function Home() {
  const apiBase = API_BASE;

  const [activeTab, setActiveTab] = useState<TabKey>("upload");
  const [tenantId, setTenantId] = useState("");
  const [tenantProfile, setTenantProfile] = useState<TenantProfile>({ company_name: "", company_nif: "" });

  const [rows, setRows] = useState<Invoice[]>([]);
  const [failedImports, setFailedImports] = useState<FailedImportRow[]>([]);
  const [reviewLineItems, setReviewLineItems] = useState<ReviewLineItem[]>([]);
  const [automationBlockers, setAutomationBlockers] = useState<AutomationBlocker[]>([]);

  const [files, setFiles] = useState<FileList | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadListFilter, setUploadListFilter] = useState<"all" | "good" | "review" | "rejected">("all");
  const [uploadStage, setUploadStage] = useState<"idle" | UploadStep | "done" | "error">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadRejected, setUploadRejected] = useState<RejectedUploadRow[]>([]);

  const [isQueueLoading, setIsQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [isSavingTenantProfile, setIsSavingTenantProfile] = useState(false);

  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const pendingInvoiceDeleteRef = useRef<Record<string, { invoice: Invoice; timeoutId: number }>>({});
  const pendingFailedDeleteRef = useRef<Record<string, { row: FailedImportRow; timeoutId: number }>>({});

  const [queueStatusFilter, setQueueStatusFilter] = useState<"all" | "review" | "processed" | "error">("all");
  const [queueVendorFilter, setQueueVendorFilter] = useState("");
  const [queueSort, setQueueSort] = useState<QueueSort>("created_desc");

  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState | null>(null);
  const [detailForm, setDetailForm] = useState<EditableInvoiceForm>(emptyForm());
  const [detailLineItems, setDetailLineItems] = useState<EditableInvoiceLineItem[]>([]);
  const [isSavingDetail, setIsSavingDetail] = useState(false);

  const [health, setHealth] = useState<SystemHealth>({
    api: "checking",
    db: "checking",
    ocr: "checking",
    ocrDetail: "—",
    lastChecked: null,
  });

  const [telemetry, setTelemetry] = useState<UploadTelemetry>({
    started: 0,
    completed: 0,
    failed: 0,
    stepHits: {
      validate: 0,
      extract: 0,
      review: 0,
      save: 0,
    },
  });
  const [serverFunnel, setServerFunnel] = useState<Record<UploadStep, { enter: number; success: number; failure: number }>>(
    emptyServerFunnel()
  );

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [queueSearchInput, setQueueSearchInput] = useState("");

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");

  const queueChordArmedRef = useRef(false);
  const queueChordTimerRef = useRef<number | null>(null);
  const uploadSessionIdRef = useRef(makeId());
  const detailSectionRef = useRef<HTMLElement | null>(null);
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

  const dismissToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">, timeoutMs = 6000) => {
      const id = makeId();
      setToasts((prev) => [...prev, { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), timeoutMs);
    },
    [dismissToast]
  );

  const bumpUploadStep = useCallback((step: UploadStep) => {
    setTelemetry((prev) => ({
      ...prev,
      stepHits: {
        ...prev.stepHits,
        [step]: prev.stepHits[step] + 1,
      },
    }));
  }, []);

  const sendUploadTelemetryEvent = useCallback(
    async (step: UploadStep, status: "enter" | "success" | "failure", context?: string) => {
      try {
        await fetch(`${apiBase}/api/tenants/${tenantId}/telemetry/upload-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            step,
            status,
            session_id: uploadSessionIdRef.current,
            context,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // best-effort telemetry
      }
    },
    [apiBase, tenantId]
  );

  const fetchUploadTelemetrySummary = useCallback(async () => {
    if (!tenantId) return;
    try {
      const response = await fetch(`${apiBase}/api/tenants/${tenantId}/telemetry/upload-funnel?hours=72`);
      const data = (await parseResponse(response)) as UploadFunnelResponseServer;
      if (!response.ok || !Array.isArray(data?.steps)) return;
      const next = emptyServerFunnel();
      data.steps.forEach((step) => {
        if (step.step in next) {
          next[step.step as UploadStep] = {
            enter: Number(step.enter || 0),
            success: Number(step.success || 0),
            failure: Number(step.failure || 0),
          };
        }
      });
      setServerFunnel(next);
    } catch {
      // telemetry summary is optional
    }
  }, [tenantId, apiBase]);

  const refreshQueueData = useCallback(async () => {
    if (!tenantId) return;
    setQueueError("");
    setIsQueueLoading(true);

    const endpointErrors: string[] = [];

    const loadSection = async <T,>(label: string, url: string): Promise<T | null> => {
      try {
        const response = await fetch(url);
        const data = (await parseResponse(response)) as T & { detail?: string };
        if (!response.ok) {
          endpointErrors.push(`${label}: ${data?.detail || "erro interno"}`);
          return null;
        }
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : "erro de ligação";
        endpointErrors.push(`${label}: ${message}`);
        return null;
      }
    };

    try {
      const [invoicesData, failedData, reviewData, blockersData] = await Promise.all([
        loadSection<{ items?: Invoice[] }>("faturas", `${apiBase}/api/tenants/${tenantId}/invoices`),
        loadSection<{ items?: FailedImportRow[] }>("falhas", `${apiBase}/api/tenants/${tenantId}/failed-imports`),
        loadSection<{ items?: ReviewLineItem[] }>("revisão", `${apiBase}/api/tenants/${tenantId}/line-items/review`),
        loadSection<{ items?: AutomationBlocker[] }>("bloqueios", `${apiBase}/api/tenants/${tenantId}/automation-blockers`),
      ]);

      if (invoicesData?.items) setRows(Array.isArray(invoicesData.items) ? invoicesData.items : []);
      if (failedData?.items) setFailedImports(Array.isArray(failedData.items) ? failedData.items : []);
      if (reviewData?.items) setReviewLineItems(Array.isArray(reviewData.items) ? reviewData.items : []);
      if (blockersData?.items) setAutomationBlockers(Array.isArray(blockersData.items) ? blockersData.items : []);

      if (endpointErrors.length > 0) {
        const message = `Algumas secções falharam: ${endpointErrors.join(" · ")}`;
        setQueueError(message);
        pushToast({ type: "error", title: "Atualização parcial da fila", detail: message });
      }
    } finally {
      setIsQueueLoading(false);
    }
  }, [tenantId, apiBase, pushToast]);

  const fetchTenantProfile = useCallback(async () => {
    if (!tenantId) return;
    try {
      const response = await fetch(`${apiBase}/api/tenants/${tenantId}/profile`);
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.detail || "Falha ao carregar perfil do tenant");
      setTenantProfile({
        company_name: data.company_name ?? "",
        company_nif: data.company_nif ?? "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar perfil do tenant";
      pushToast({ type: "error", title: "Erro no perfil", detail: message });
    }
  }, [tenantId, apiBase, pushToast]);

  const fetchSystemHealth = useCallback(async () => {
    setHealth((prev) => ({ ...prev, api: "checking", db: "checking", ocr: "checking" }));
    try {
      const [apiRes, readyRes, watchtowerRes] = await Promise.all([
        fetch(`${apiBase}/api/health`),
        fetch(`${apiBase}/api/ready`),
        fetch(`${apiBase}/api/watchtower/uploads`),
      ]);

      const [apiData, readyData, watchtowerData] = await Promise.all([
        parseResponse(apiRes),
        parseResponse(readyRes),
        parseResponse(watchtowerRes),
      ]);

      const active = Array.isArray(watchtowerData?.active) ? watchtowerData.active : [];
      const stuckCount = active.filter((task: { stuck?: boolean }) => Boolean(task.stuck)).length;

      setHealth({
        api: apiRes.ok && apiData?.ok ? "ok" : "down",
        db: readyRes.ok && readyData?.ready ? "ok" : "down",
        ocr: !watchtowerRes.ok ? "down" : stuckCount > 0 ? "warn" : "ok",
        ocrDetail: watchtowerRes.ok
          ? `${active.length} ativo(s)${stuckCount > 0 ? ` · ${stuckCount} preso(s)` : ""}`
          : "watchtower indisponível",
        lastChecked: new Date().toISOString(),
      });
    } catch {
      setHealth({
        api: "down",
        db: "down",
        ocr: "down",
        ocrDetail: "sem ligação",
        lastChecked: new Date().toISOString(),
      });
    }
  }, [apiBase]);

  const openInvoiceDetail = useCallback((invoice: Invoice) => {
    setDetailInvoice(invoice);
    setDetailForm({
      vendor: invoice.vendor ?? "",
      category: invoice.category ?? "",
      invoice_number: invoice.invoice_number ?? "",
      invoice_date: toPtDate(invoice.invoice_date),
      due_date: toPtDate(invoice.due_date),
      supplier_nif: invoice.supplier_nif ?? "",
      customer_name: invoice.customer_name ?? "",
      customer_nif: invoice.customer_nif ?? "",
      subtotal: toPtNumberString(invoice.subtotal),
      tax: toPtNumberString(invoice.tax),
      total: toPtNumberString(invoice.total),
      notes: invoice.notes ?? "",
    });
    setDetailLineItems((invoice.line_items ?? []).map(toEditableLineItem));

    window.setTimeout(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 90);
    pushToast({ type: "info", title: "Editor aberto", detail: `Pode corrigir ${invoice.filename} abaixo.` });
  }, [pushToast]);

  const openInvoiceById = useCallback(
    (invoiceId: string) => {
      const target = rows.find((row) => row.id === invoiceId);
      if (!target) {
        pushToast({ type: "error", title: "Fatura não encontrada", detail: invoiceId });
        return;
      }
      setActiveTab("queue");
      openInvoiceDetail(target);
      pushToast({ type: "info", title: "A abrir editor", detail: "A fatura foi aberta na fila para edição." });
    },
    [rows, openInvoiceDetail, pushToast]
  );

  const openInvoicePdfById = useCallback(
    async (invoiceId: string) => {
      try {
        const response = await fetch(`${apiBase}/api/tenants/${tenantId}/invoices/${invoiceId}/pdf-url`);
        const data = await parseResponse(response);
        if (!response.ok) throw new Error(data?.detail || "PDF indisponível");
        if (!data?.url) throw new Error("URL do PDF em falta");
        window.open(data.url, "_blank", "noopener,noreferrer");
      } catch (error) {
        openInvoiceById(invoiceId);
        const message = error instanceof Error ? error.message : "PDF indisponível";
        pushToast({ type: "info", title: "PDF indisponível", detail: `${message}. Abri a fatura para edição.` });
      }
    },
    [apiBase, tenantId, openInvoiceById, pushToast]
  );

  const handleDetailLineItemChange = useCallback((index: number, field: keyof EditableInvoiceLineItem, value: string) => {
    setDetailLineItems((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }, []);

  const addDetailLineItem = useCallback(() => {
    setDetailLineItems((prev) => [...prev, createEmptyEditableLineItem()]);
  }, []);

  const insertDetailLineItemAt = useCallback((index: number) => {
    setDetailLineItems((prev) => {
      const next = [...prev];
      next.splice(index, 0, createEmptyEditableLineItem());
      return next;
    });
  }, []);

  const removeDetailLineItem = useCallback((index: number) => {
    setDetailLineItems((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const saveInvoiceDetail = useCallback(async () => {
    if (!detailInvoice) return;
    setIsSavingDetail(true);
    try {
      const payload = {
        vendor: detailForm.vendor,
        category: detailForm.category,
        invoice_number: detailForm.invoice_number,
        invoice_date: toIsoDate(detailForm.invoice_date),
        due_date: toIsoDate(detailForm.due_date),
        supplier_nif: detailForm.supplier_nif,
        customer_name: detailForm.customer_name,
        customer_nif: detailForm.customer_nif,
        subtotal: parsePtNumber(detailForm.subtotal),
        tax: parsePtNumber(detailForm.tax),
        total: parsePtNumber(detailForm.total),
        notes: detailForm.notes,
        status: "corrigido",
        requires_review: false,
        line_items: detailLineItems
          .filter((line) => Object.values(line).some((value) => String(value ?? "").trim() !== ""))
          .map((line) => ({
            id: line.id,
            code: line.code.trim() || null,
            description: line.description.trim() || null,
            quantity: parsePtNumber(line.quantity),
            unit_price: parsePtNumber(line.unit_price),
            line_subtotal: parsePtNumber(line.line_subtotal),
            line_tax_amount: parsePtNumber(line.line_tax_amount),
            line_total: parsePtNumber(line.line_total),
            tax_rate: parsePtNumber(line.tax_rate),
          })),
      };

      const response = await fetch(`${apiBase}/api/invoices/${detailInvoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId },
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.detail || "Falha ao guardar alterações");

      setRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setDetailInvoice(data);
      setDetailForm({
        vendor: data.vendor ?? "",
        category: data.category ?? "",
        invoice_number: data.invoice_number ?? "",
        invoice_date: toPtDate(data.invoice_date),
        due_date: toPtDate(data.due_date),
        supplier_nif: data.supplier_nif ?? "",
        customer_name: data.customer_name ?? "",
        customer_nif: data.customer_nif ?? "",
        subtotal: toPtNumberString(data.subtotal),
        tax: toPtNumberString(data.tax),
        total: toPtNumberString(data.total),
        notes: data.notes ?? "",
      });
      setDetailLineItems((data.line_items ?? []).map(toEditableLineItem));
      pushToast({ type: "success", title: "Fatura guardada", detail: data.invoice_number || data.filename });
      await refreshQueueData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao guardar alterações";
      pushToast({ type: "error", title: "Erro ao guardar", detail: `${message}. ${guidanceForError(message)}` });
    } finally {
      setIsSavingDetail(false);
    }
  }, [detailInvoice, detailForm, detailLineItems, apiBase, refreshQueueData, pushToast, tenantId]);

  const queueInvoiceDelete = useCallback(
    async (invoice: Invoice) => {
      const confirmed = window.confirm(`Apagar fatura ${invoice.invoice_number || invoice.filename}?`);
      if (!confirmed) return;

      try {
        const response = await fetch(`${apiBase}/api/invoices/${invoice.id}`, {
          method: "DELETE",
          headers: { "X-Tenant-Id": tenantId },
        });
        if (!response.ok) {
          const data = await parseResponse(response);
          throw new Error(data?.detail || "Falha ao apagar fatura");
        }

        setRows((prev) => prev.filter((row) => row.id !== invoice.id));
        setSelectedInvoiceIds((prev) => prev.filter((id) => id !== invoice.id));
        if (detailInvoice?.id === invoice.id) {
          setDetailInvoice(null);
          setDetailForm(emptyForm());
          setDetailLineItems([]);
        }
        pushToast({ type: "success", title: "Fatura apagada", detail: invoice.filename });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao apagar fatura";
        pushToast({ type: "error", title: "Não foi possível apagar", detail: `${message}. ${guidanceForError(message)}` });
      }
    },
    [apiBase, detailInvoice, pushToast, tenantId]
  );

  const commitFailedImportDelete = useCallback(
    async (rowId: string) => {
      const pending = pendingFailedDeleteRef.current[rowId];
      if (!pending) return;
      try {
        const response = await fetch(`${apiBase}/api/failed-imports/${rowId}`, {
          method: "DELETE",
          headers: { "X-Tenant-Id": tenantId },
        });
        if (!response.ok) {
          const data = await parseResponse(response);
          throw new Error(data?.detail || "Falha ao apagar falha");
        }
        pushToast({ type: "success", title: "Falha removida", detail: pending.row.filename });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao apagar falha";
        setFailedImports((prev) => [pending.row, ...prev]);
        pushToast({ type: "error", title: "Não foi possível remover", detail: message });
      } finally {
        delete pendingFailedDeleteRef.current[rowId];
      }
    },
    [apiBase, pushToast, tenantId]
  );

  const undoFailedImportDelete = useCallback(
    (rowId: string) => {
      const pending = pendingFailedDeleteRef.current[rowId];
      if (!pending) return;
      window.clearTimeout(pending.timeoutId);
      setFailedImports((prev) => [pending.row, ...prev]);
      delete pendingFailedDeleteRef.current[rowId];
      pushToast({ type: "info", title: "Remoção revertida", detail: pending.row.filename });
    },
    [pushToast]
  );

  const queueFailedImportDelete = useCallback(
    (row: FailedImportRow) => {
      const confirmed = window.confirm(`Remover falha ${row.filename}?`);
      if (!confirmed) return;

      setFailedImports((prev) => prev.filter((item) => item.id !== row.id));
      const timeoutId = window.setTimeout(() => {
        void commitFailedImportDelete(row.id);
      }, 5000);

      pendingFailedDeleteRef.current[row.id] = { row, timeoutId };
      pushToast(
        {
          type: "info",
          title: "Falha agendada para remoção",
          detail: "Ação destrutiva com janela de Undo de 5s.",
          actionLabel: "Undo",
          onAction: () => undoFailedImportDelete(row.id),
        },
        5200
      );
    },
    [commitFailedImportDelete, undoFailedImportDelete, pushToast]
  );

  const handleRetryFailedImport = useCallback(
    async (row: FailedImportRow) => {
      try {
        const response = await fetch(`${apiBase}/api/failed-imports/${row.id}/retry`, {
          method: "POST",
          headers: { "X-Tenant-Id": tenantId },
        });
        const data = await parseResponse(response);
        if (!response.ok) throw new Error(data?.detail || "Falha no retry");

        if (data?.ok && data?.ingested) {
          pushToast({ type: "success", title: "Retry concluído", detail: row.filename });
        } else {
          pushToast({ type: "error", title: "Retry rejeitado", detail: data?.rejected?.reason || row.filename });
        }
        await refreshQueueData();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha no retry";
        pushToast({ type: "error", title: "Erro no retry", detail: `${message}. ${guidanceForError(message)}` });
      }
    },
    [apiBase, refreshQueueData, pushToast, tenantId]
  );

  const saveTenantProfile = useCallback(async () => {
    setIsSavingTenantProfile(true);
    try {
      const response = await fetch(`${apiBase}/api/tenants/${tenantId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenantProfile),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.detail || "Falha ao guardar perfil");
      setTenantProfile({
        company_name: data.company_name ?? "",
        company_nif: data.company_nif ?? "",
      });
      pushToast({ type: "success", title: "Perfil guardado" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao guardar perfil";
      pushToast({ type: "error", title: "Erro no perfil", detail: `${message}. ${guidanceForError(message)}` });
    } finally {
      setIsSavingTenantProfile(false);
    }
  }, [apiBase, tenantId, tenantProfile, pushToast]);

  const performUpload = useCallback(async () => {
    if (!tenantId.trim()) {
      const message = "Tenant em falta";
      setUploadError(`${message}. ${guidanceForError(message)}`);
      setUploadSuccess("");
      pushToast({ type: "error", title: message, detail: guidanceForError(message) });
      return;
    }
    if (!files || files.length === 0) {
      const message = "Sem documentos selecionados";
      setUploadError(`${message}. ${guidanceForError(message)}`);
      setUploadSuccess("");
      pushToast({ type: "error", title: message, detail: guidanceForError(message) });
      return;
    }

    uploadSessionIdRef.current = makeId();
    setIsUploading(true);
    setUploadError("");
    setUploadSuccess("");
    setUploadRejected([]);
    setTelemetry((prev) => ({ ...prev, started: prev.started + 1 }));

    let currentStep: UploadStep = "validate";

    try {
      setUploadStage("validate");
      bumpUploadStep("validate");
      void sendUploadTelemetryEvent("validate", "enter", "upload_started");

      const selectedFiles = Array.from(files);
      const aggregated = {
        ingested: [] as Invoice[],
        rejected: [] as Array<{ filename: string; reason: string; detected_type?: string }>,
        duplicates: [] as Array<{ uploaded: Invoice; existing_invoice_id: string }>,
      };

      await new Promise((resolve) => window.setTimeout(resolve, 160));
      currentStep = "extract";
      setUploadStage("extract");
      bumpUploadStep("extract");
      void sendUploadTelemetryEvent("extract", "enter");

      for (const file of selectedFiles) {
        try {
          const initResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/storage/uploads/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              content_type: file.type || null,
              file_size: file.size,
            }),
          });
          const initData = await parseResponse(initResponse);
          if (!initResponse.ok) throw new Error(initData?.detail || `Falha ao iniciar upload de ${file.name}`);

          const uploadResponse = await fetch(initData.upload_url, {
            method: "PUT",
            headers: file.type ? { "Content-Type": file.type } : undefined,
            body: file,
          });
          if (!uploadResponse.ok) throw new Error(`Falha no envio para storage (${file.name})`);

          const completeResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/storage/uploads/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              object_key: initData.object_key,
              filename: file.name,
              content_type: file.type || null,
            }),
          });
          const completeData = await parseResponse(completeResponse);
          if (!completeResponse.ok) throw new Error(completeData?.detail || `Falha ao finalizar upload de ${file.name}`);

          aggregated.ingested.push(...(completeData?.ingested ?? []));
          aggregated.rejected.push(...(completeData?.rejected ?? []));
          aggregated.duplicates.push(...(completeData?.duplicates ?? []));
        } catch (fileError) {
          const storageReason = fileError instanceof Error ? fileError.message : "Falha no upload para storage";
          const loweredStorageReason = storageReason.toLowerCase();
          const shouldFallbackToDirectIngest =
            loweredStorageReason.includes("failed to fetch") ||
            loweredStorageReason.includes("cors") ||
            loweredStorageReason.includes("falha no envio para storage") ||
            loweredStorageReason.includes("upload para storage");

          if (!shouldFallbackToDirectIngest) {
            let reason = storageReason;
            try {
              const failedResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/failed-imports`);
              const failedData = await parseResponse(failedResponse);
              const latestMatch = (failedData?.items ?? []).find((item: FailedImportRow) => item.filename === file.name);
              if (latestMatch?.reason) {
                reason = latestMatch.reason;
              }
            } catch {
              // keep original reason
            }
            aggregated.rejected.push({ filename: file.name, reason, detected_type: "storage_upload_error" });
            continue;
          }

          try {
            // Fallback path only when browser-to-storage upload fails.
            const fallbackFormData = new FormData();
            fallbackFormData.append("files", file);
            const fallbackResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/ingest`, {
              method: "POST",
              body: fallbackFormData,
            });
            const fallbackData = await parseResponse(fallbackResponse);
            if (!fallbackResponse.ok) {
              throw new Error(fallbackData?.detail || `Falha no fallback ingest (${file.name})`);
            }
            aggregated.ingested.push(...(fallbackData?.ingested ?? []));
            aggregated.rejected.push(...(fallbackData?.rejected ?? []));
            aggregated.duplicates.push(...(fallbackData?.duplicates ?? []));
          } catch (fallbackError) {
            const fallbackReason = fallbackError instanceof Error ? fallbackError.message : "Falha no fallback ingest";
            const loweredFallbackReason = fallbackReason.toLowerCase();
            let reason =
              loweredStorageReason.includes("502 bad gateway") ||
              loweredFallbackReason.includes("502 bad gateway") ||
              loweredStorageReason.includes("bad gateway") ||
              loweredFallbackReason.includes("bad gateway")
                ? "O serviço devolveu um erro temporário de gateway durante o processamento do ficheiro."
                : loweredStorageReason.includes("socket hang up") ||
                    loweredFallbackReason.includes("socket hang up") ||
                    loweredStorageReason.includes("econnreset") ||
                    loweredFallbackReason.includes("econnreset")
                  ? "Falha técnica de ligação ao serviço de ingestão durante o upload (socket hang up)."
                  : loweredStorageReason.includes("timeout") || loweredFallbackReason.includes("timeout")
                    ? "Tempo limite excedido durante a análise do documento."
                    : `${storageReason}; fallback: ${fallbackReason}`;

            try {
              const invoiceResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/invoices`);
              const invoiceData = await parseResponse(invoiceResponse);
              const latestInvoiceMatch = (invoiceData?.items ?? []).find((item: Invoice) => item.filename === file.name);
              if (latestInvoiceMatch) {
                aggregated.ingested.push(latestInvoiceMatch);
                if (latestInvoiceMatch.duplicate_candidate_invoice_id) {
                  aggregated.duplicates.push({
                    uploaded: latestInvoiceMatch,
                    existing_invoice_id: latestInvoiceMatch.duplicate_candidate_invoice_id,
                  });
                }
                continue;
              }
            } catch {
              // If invoice lookup fails, continue with failed-import lookup.
            }

            try {
              const failedResponse = await fetch(`${apiBase}/api/tenants/${tenantId}/failed-imports`);
              const failedData = await parseResponse(failedResponse);
              const latestMatch = (failedData?.items ?? []).find((item: FailedImportRow) => item.filename === file.name);
              if (latestMatch?.reason) {
                reason = latestMatch.reason;
              }
            } catch {
              // Keep synthesized reason if failed-import lookup also fails.
            }

            aggregated.rejected.push({ filename: file.name, reason, detected_type: "storage_upload_error" });
          }
        }
      }

      currentStep = "review";
      setUploadStage("review");
      bumpUploadStep("review");
      void sendUploadTelemetryEvent("review", "enter");

      const ingestedFiles = new Set(
        (aggregated.ingested as Array<{ filename?: string }>).map((item) => String(item?.filename || "").trim()).filter(Boolean)
      );
      const reconciledRejected = aggregated.rejected.filter((item) => !ingestedFiles.has(String(item.filename || "").trim()));

      const ingestedCount = aggregated.ingested.length;
      const rejectedCount = reconciledRejected.length;

      currentStep = "save";
      setUploadStage("save");
      bumpUploadStep("save");
      void sendUploadTelemetryEvent("save", "enter");

      const message = `Processados ${ingestedCount} documento(s)${rejectedCount ? ` · ${rejectedCount} rejeitado(s)` : ""}.`;
      setUploadSuccess(
        rejectedCount
          ? `${message} Veja abaixo os motivos de rejeição por ficheiro.`
          : message
      );
      setUploadRejected(reconciledRejected);
      const duplicateCandidate = aggregated.duplicates[0];
      if (duplicateCandidate) {
        setDuplicateReview({ uploaded: duplicateCandidate.uploaded, existingId: duplicateCandidate.existing_invoice_id });
      }
      setFiles(null);
      setFileInputKey((prev) => prev + 1);

      setTelemetry((prev) => ({ ...prev, completed: prev.completed + 1 }));
      void sendUploadTelemetryEvent("save", "success", `ingested:${ingestedCount};rejected:${rejectedCount}`);
      pushToast({
        type: rejectedCount ? "info" : "success",
        title: rejectedCount ? "Upload concluído com rejeições" : "Upload concluído",
        detail: rejectedCount
          ? `${message} Consulte a lista de documentos rejeitados logo abaixo.`
          : message,
      });

      await refreshQueueData();
      await fetchSystemHealth();
      await fetchUploadTelemetrySummary();

      setUploadStage("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha no upload";
      setUploadError(`${message}. ${guidanceForError(message)}`);
      setUploadStage("error");
      setTelemetry((prev) => ({ ...prev, failed: prev.failed + 1 }));
      void sendUploadTelemetryEvent(currentStep, "failure", message.slice(0, 180));
      pushToast({ type: "error", title: "Upload falhou", detail: `${message}. ${guidanceForError(message)}` });
    } finally {
      setIsUploading(false);
    }
  }, [tenantId, files, apiBase, bumpUploadStep, refreshQueueData, fetchSystemHealth, fetchUploadTelemetrySummary, pushToast, sendUploadTelemetryEvent]);

  const handleBulkDelete = useCallback(() => {
    if (selectedInvoiceIds.length === 0) return;
    const confirmed = window.confirm(`Apagar ${selectedInvoiceIds.length} fatura(s) selecionada(s)?`);
    if (!confirmed) return;
    const map = new Map(rows.map((row) => [row.id, row]));
    selectedInvoiceIds.forEach((invoiceId) => {
      const invoice = map.get(invoiceId);
      if (invoice) queueInvoiceDelete(invoice);
    });
  }, [selectedInvoiceIds, rows, queueInvoiceDelete]);

  const handleSendChat = useCallback(async () => {
    const question = chatInput.trim();
    if (!question) return;

    const userMessage: ChatMessage = { id: makeId(), role: "user", text: question };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatError("");
    setIsChatLoading(true);

    try {
      const response = await fetch(`${apiBase}/api/tenants/${tenantId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.detail || "Falha ao consultar" );

      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        text: data?.answer ?? "Sem resposta",
        references: data?.references ?? [],
      };
      setChatHistory((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar";
      setChatError(`${message}. ${guidanceForError(message)}`);
      setChatHistory((prev) => [...prev, { id: makeId(), role: "assistant", text: message }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, apiBase, tenantId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TELEMETRY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UploadTelemetry>;
      if (!parsed || typeof parsed !== "object") return;
      setTelemetry((prev) => ({
        started: Number(parsed.started ?? prev.started),
        completed: Number(parsed.completed ?? prev.completed),
        failed: Number(parsed.failed ?? prev.failed),
        stepHits: {
          validate: Number(parsed.stepHits?.validate ?? prev.stepHits.validate),
          extract: Number(parsed.stepHits?.extract ?? prev.stepHits.extract),
          review: Number(parsed.stepHits?.review ?? prev.stepHits.review),
          save: Number(parsed.stepHits?.save ?? prev.stepHits.save),
        },
      }));
    } catch {
      // ignore malformed telemetry cache
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(telemetry));
  }, [telemetry]);

  useEffect(() => {
    if (!tenantReady) return;
    void fetchTenantProfile();
    void refreshQueueData();
    void fetchSystemHealth();
    void fetchUploadTelemetrySummary();
  }, [tenantReady, fetchTenantProfile, refreshQueueData, fetchSystemHealth, fetchUploadTelemetrySummary]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchSystemHealth();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [fetchSystemHealth]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        (target?.isContentEditable ?? false);

      if (event.key === "/" && !typing) {
        event.preventDefault();
        setActiveTab("search");
        window.setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
        return;
      }

      if (typing) return;

      if (event.key.toLowerCase() === "u") {
        setActiveTab("upload");
        return;
      }

      if (event.key.toLowerCase() === "g") {
        queueChordArmedRef.current = true;
        if (queueChordTimerRef.current) window.clearTimeout(queueChordTimerRef.current);
        queueChordTimerRef.current = window.setTimeout(() => {
          queueChordArmedRef.current = false;
        }, 900);
        return;
      }

      if (event.key.toLowerCase() === "q" && queueChordArmedRef.current) {
        setActiveTab("queue");
        queueChordArmedRef.current = false;
        if (queueChordTimerRef.current) {
          window.clearTimeout(queueChordTimerRef.current);
          queueChordTimerRef.current = null;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (queueChordTimerRef.current) window.clearTimeout(queueChordTimerRef.current);
    };
  }, []);

  const queueVendorOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.vendor).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const queueRows = useMemo(() => {
    const query = queueSearchInput.trim().toLowerCase();
    const vendor = queueVendorFilter.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      const state = invoiceQueueState(row);
      if (queueStatusFilter !== "all" && state !== queueStatusFilter) return false;
      if (vendor && !(row.vendor || "").toLowerCase().includes(vendor)) return false;
      if (!query) return true;

      const haystack = [
        row.vendor || "",
        row.invoice_number || "",
        row.filename || "",
        row.category || "",
        row.status || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    return filtered.sort((a, b) => {
      if (queueSort === "created_desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (queueSort === "created_asc") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (queueSort === "confidence_asc") return Number(a.confidence_score ?? -1) - Number(b.confidence_score ?? -1);
      if (queueSort === "confidence_desc") return Number(b.confidence_score ?? -1) - Number(a.confidence_score ?? -1);
      if (queueSort === "total_desc") return Number(b.total ?? -1) - Number(a.total ?? -1);
      return (a.vendor || "").localeCompare(b.vendor || "");
    });
  }, [rows, queueSearchInput, queueVendorFilter, queueStatusFilter, queueSort]);

  const uploadInboxRows = useMemo<UploadInboxRow[]>(() => {
    const invoiceRows: UploadInboxRow[] = rows.slice(0, 20).map((row) => {
      const state = invoiceQueueState(row);
      return {
        kind: "invoice",
        id: row.id,
        filename: row.filename,
        statusLabel: state === "review" ? "precisa de revisão" : state === "error" ? "erro" : "processada",
        statusTone: state === "review" ? "warn" : state === "error" ? "error" : "success",
        vendor: row.vendor,
        createdAt: row.created_at,
        invoice: row,
      };
    });

    const rejectedRows: UploadInboxRow[] = failedImports.slice(0, 20).map((row) => ({
      kind: "rejected",
      id: row.id,
      filename: row.filename,
      statusLabel: "rejected",
      statusTone: "error",
      reason: row.reason,
      detectedType: row.detected_type,
      createdAt: row.created_at,
    }));

    return [...invoiceRows, ...rejectedRows]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 20);
  }, [rows, failedImports]);

  const filteredUploadInboxRows = useMemo(() => {
    if (uploadListFilter === "all") return uploadInboxRows;
    return uploadInboxRows.filter((item) => {
      if (uploadListFilter === "rejected") return item.kind === "rejected";
      if (uploadListFilter === "review") return item.statusLabel === "precisa de revisão";
      if (uploadListFilter === "good") return item.statusLabel === "processada";
      return true;
    });
  }, [uploadInboxRows, uploadListFilter]);

  const queueSummary = useMemo(() => {
    const review = rows.filter((row) => invoiceQueueState(row) === "review").length;
    const errors = rows.filter((row) => invoiceQueueState(row) === "error").length;
    const processed = rows.filter((row) => invoiceQueueState(row) === "processed").length;
    return { total: rows.length, review, errors, processed };
  }, [rows]);

  const attentionRows = useMemo(() => queueRows.filter((row) => invoiceQueueState(row) !== "processed"), [queueRows]);
  const processedRows = useMemo(() => queueRows.filter((row) => invoiceQueueState(row) === "processed"), [queueRows]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows.slice(0, 20);
    return rows
      .filter((row) => {
        const haystack = `${row.vendor || ""} ${row.invoice_number || ""} ${row.filename || ""} ${row.category || ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 50);
  }, [rows, searchQuery]);

  const uploadProgress = useMemo(() => {
    if (uploadStage === "idle") return 0;
    if (uploadStage === "validate") return 25;
    if (uploadStage === "extract") return 50;
    if (uploadStage === "review") return 75;
    if (uploadStage === "save") return 90;
    if (uploadStage === "done") return 100;
    return 100;
  }, [uploadStage]);

  const stepDropoff = useMemo(() => {
    const base = telemetry.started;
    const validateDrop = Math.max(base - telemetry.stepHits.validate, 0);
    const extractDrop = Math.max(telemetry.stepHits.validate - telemetry.stepHits.extract, 0);
    const reviewDrop = Math.max(telemetry.stepHits.extract - telemetry.stepHits.review, 0);
    const saveDrop = Math.max(telemetry.stepHits.review - telemetry.stepHits.save, 0);
    return { validateDrop, extractDrop, reviewDrop, saveDrop };
  }, [telemetry]);

  const allVisibleSelected = queueRows.length > 0 && queueRows.every((row) => selectedInvoiceIds.includes(row.id));

  const renderStatusPill = (label: string, value: HealthLevel, detail?: string) => (
    <div className={`status-pill ${value}`}>
      <span className="dot" />
      <div>
        <div className="status-label">{label}</div>
        <div className="status-detail">{value === "checking" ? "a verificar" : detail || value}</div>
      </div>
    </div>
  );

  const primaryAction = () => {
    if (activeTab === "upload") return void performUpload();
    if (activeTab === "queue") return void refreshQueueData();
    setActiveTab("search");
    searchInputRef.current?.focus();
  };

  const primaryActionLabel = activeTab === "upload"
    ? isUploading
      ? "A processar..."
      : "Processar faturas"
    : activeTab === "queue"
      ? "Atualizar fila"
      : "Focar pesquisa";

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <p className="eyebrow">ViaContab · UX Pass 1</p>
          <h1>Contabilidade com fluxo claro</h1>
          <p className="subtext">Tabs claras, passo-a-passo no upload, fila com bulk actions e pesquisa rápida.</p>
        </div>
        <div className="shortcut-hints">Atalhos: <kbd>/</kbd> Pesquisar · <kbd>u</kbd> Enviar · <kbd>g</kbd> <kbd>q</kbd> Faturas</div>
        <div className="inline-state neutral" style={{ marginTop: 10 }}>Tenant atual: <strong>{tenantId || "a aguardar contexto"}</strong></div>
      </header>

      {!tenantReady ? (
        <section className="card">
          <h2>A aguardar contexto do tenant</h2>
          <p className="card-sub">O módulo só é carregado depois de receber o tenant da plataforma principal.</p>
        </section>
      ) : (
        <>
          <nav className="tabs-nav" aria-label="Navegação principal">
            <button className={activeTab === "upload" ? "tab active" : "tab"} onClick={() => setActiveTab("upload")}>
              Enviar
            </button>
            <button className={activeTab === "queue" ? "tab active" : "tab"} onClick={() => setActiveTab("queue")}>
              Faturas
            </button>
            <button className={activeTab === "search" ? "tab active" : "tab"} onClick={() => setActiveTab("search")}>
              Pesquisar
            </button>
          </nav>

          <main className="content-grid">
            {activeTab === "upload" && (
          <>
            <section className="card">
              <h2>Fluxo de upload</h2>
              <p className="card-sub">Validar → Extrair → Rever → Guardar com feedback em tempo real.</p>

              <div className="stepper">
                {UPLOAD_STEPS.map((step) => {
                  const stageIndex =
                    uploadStage === "done"
                      ? UPLOAD_STEPS.length
                      : uploadStage === "idle" || uploadStage === "error"
                        ? -1
                        : UPLOAD_STEPS.indexOf(uploadStage);
                  const isDone = UPLOAD_STEPS.indexOf(step) < stageIndex;
                  const isCurrent = uploadStage === step;
                  return (
                    <div key={step} className={`step ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}>
                      <span className="step-index">{UPLOAD_STEPS.indexOf(step) + 1}</span>
                      <span>{getStageLabel(step)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="progress-track" aria-hidden>
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>

              <div
                className={`upload-dropzone ${isDragActive ? "active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                  if (event.dataTransfer.files?.length) setFiles(event.dataTransfer.files);
                }}
              >
                <label className="field" style={{ margin: 0 }}>
                  <span>Documentos (PDF/JPG/PNG/ZIP)</span>
                  <input
                    key={fileInputKey}
                    type="file"
                    multiple
                    onChange={(event) => setFiles(event.target.files)}
                    disabled={isUploading}
                  />
                </label>
                <div className="dropzone-hint">Arraste ficheiros para aqui ou clique para selecionar.</div>
              </div>

              <div className="actions-row">
                <button
                  className="primary-btn"
                  onClick={() => void performUpload()}
                  disabled={isUploading || !files || files.length === 0}
                >
                  {isUploading ? "A processar..." : "Processar faturas agora"}
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setFiles(null);
                    setFileInputKey((prev) => prev + 1);
                    setUploadError("");
                    setUploadSuccess("");
                    setUploadRejected([]);
                  }}
                  disabled={isUploading}
                >
                  Limpar seleção
                </button>
              </div>

              {uploadError ? <div className="inline-state error">{uploadError}</div> : null}
              {uploadSuccess ? <div className={`inline-state ${uploadRejected.length ? "warn" : "success"}`}>{uploadSuccess}</div> : null}
              {uploadRejected.length ? (
                <div className="inline-state warn">
                  <strong>Documentos rejeitados</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                    {uploadRejected.map((item, index) => (
                      <li key={`${item.filename}-${index}`}>
                        <strong>{item.filename}</strong>: {item.reason}
                        {item.detected_type ? ` (${item.detected_type})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!uploadError && !uploadSuccess && !uploadRejected.length ? (
                <div className="inline-state neutral">Sem upload recente. Adicione ficheiros e clique em “Processar faturas agora”.</div>
              ) : null}
            </section>

            <section className="card">
              <h2>Uploads recentes</h2>
              <p className="card-sub">Ficheiros recentes com estado, motivo de rejeição e ações rápidas.</p>

              <div className="tabs-nav" style={{ marginBottom: 12 }}>
                <button className={uploadListFilter === "all" ? "tab active" : "tab"} onClick={() => setUploadListFilter("all")}>Todos</button>
                <button className={uploadListFilter === "good" ? "tab active" : "tab"} onClick={() => setUploadListFilter("good")}>Processadas</button>
                <button className={uploadListFilter === "review" ? "tab active" : "tab"} onClick={() => setUploadListFilter("review")}>Em revisão</button>
                <button className={uploadListFilter === "rejected" ? "tab active" : "tab"} onClick={() => setUploadListFilter("rejected")}>Rejeitadas</button>
              </div>

              {filteredUploadInboxRows.length === 0 ? (
                <div className="inline-state neutral">Ainda não existem uploads recentes para este filtro.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ficheiro</th>
                        <th>Estado</th>
                        <th>Motivo</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUploadInboxRows.map((item) => (
                        <tr key={`${item.kind}-${item.id}`}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{item.filename}</div>
                            <div style={{ fontSize: "0.9em", opacity: 0.8 }}>{item.vendor || item.detectedType || "—"}</div>
                          </td>
                          <td>
                            <span className={`badge badge-large ${item.statusTone}`}>{item.statusLabel}</span>
                          </td>
                          <td>{item.reason || (item.kind === "invoice" ? "Processado com sucesso" : "—")}</td>
                          <td>
                            <div className="actions-inline">
                              {item.invoice ? (
                                <>
                                  <button className="upload-action-btn icon-only-btn" onClick={() => openInvoiceById(item.invoice!.id)} title="Editar informação" aria-label="Editar informação">
                                    <span aria-hidden="true">✏️</span>
                                  </button>
                                  <button className="upload-action-btn icon-only-btn" onClick={() => void openInvoicePdfById(item.invoice!.id)} title="Ver original" aria-label="Ver original">
                                    <span aria-hidden="true">👁️</span>
                                  </button>
                                  <button className="upload-action-btn danger icon-only-btn" onClick={() => queueInvoiceDelete(item.invoice!)} title="Eliminar fatura" aria-label="Eliminar fatura">
                                    <span aria-hidden="true">🗑️</span>
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

                      </>
        )}

        {activeTab === "queue" && (
          <>
            <section className="card">
              <div className="row-between">
                <div>
                  <h2>Faturas</h2>
                  <p className="card-sub">Veja primeiro o que precisa de atenção e depois o que já está processado.</p>
                </div>
                <div className="badge-row">
                  <span className="badge neutral">Total {queueSummary.total}</span>
                  <span className="badge warn">Precisam de atenção {queueSummary.review}</span>
                  <span className="badge success">Processadas {queueSummary.processed}</span>
                  <span className="badge error">Erros {queueSummary.errors}</span>
                </div>
              </div>

              <div className="filters-grid">
                <label className="field">
                  <span>Estado</span>
                  <select value={queueStatusFilter} onChange={(event) => setQueueStatusFilter(event.target.value as "all" | "review" | "processed" | "error")}>
                    <option value="all">Todos</option>
                    <option value="review">Revisão</option>
                    <option value="processed">Processado</option>
                    <option value="error">Erro</option>
                  </select>
                </label>

                <label className="field">
                  <span>Fornecedor</span>
                  <select value={queueVendorFilter} onChange={(event) => setQueueVendorFilter(event.target.value)}>
                    <option value="">Todos</option>
                    {queueVendorOptions.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Ordenar</span>
                  <select value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSort)}>
                    <option value="created_desc">Mais recentes</option>
                    <option value="created_asc">Mais antigas</option>
                    <option value="confidence_asc">Confiança ascendente</option>
                    <option value="confidence_desc">Confiança descendente</option>
                    <option value="total_desc">Total mais alto</option>
                    <option value="vendor_asc">Fornecedor A→Z</option>
                  </select>
                </label>

                <label className="field">
                  <span>Pesquisa na queue</span>
                  <input
                    value={queueSearchInput}
                    onChange={(event) => {
                      setQueueSearchInput(event.target.value);
                    }}
                    placeholder="fornecedor, fatura, categoria..."
                  />
                </label>
              </div>

              <div className="actions-row">
                <button className="ghost-btn" onClick={() => void refreshQueueData()} disabled={isQueueLoading}>
                  {isQueueLoading ? "A atualizar..." : "Atualizar faturas"}
                </button>
                <button className="danger-btn" disabled={selectedInvoiceIds.length === 0} onClick={handleBulkDelete}>
                  Apagar selecionadas ({selectedInvoiceIds.length})
                </button>
                <button className="ghost-btn" disabled={selectedInvoiceIds.length === 0} onClick={() => setSelectedInvoiceIds([])}>
                  Limpar seleção
                </button>
              </div>

              {queueError ? <div className="inline-state error">{queueError}</div> : null}

              {isQueueLoading ? (
                <div className="skeleton-table">
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                </div>
              ) : queueRows.length === 0 ? (
                <div className="inline-state neutral">Sem resultados para os filtros atuais.</div>
              ) : (
                <>
                  <h3 style={{ marginTop: 0 }}>Precisa de atenção</h3>
                  {attentionRows.length === 0 ? (
                    <div className="inline-state success">Nenhuma fatura pendente de atenção.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Estado</th>
                            <th>Leitura</th>
                            <th>Fornecedor</th>
                            <th>Fatura</th>
                            <th>Total</th>
                            <th>Data</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attentionRows.map((row) => {
                            const state = invoiceQueueState(row);
                            const stateLabel = state === "review" ? "precisa de atenção" : "erro";
                            const currency = row.currency || "EUR";
                            const isDuplicateCandidate = Boolean(row.duplicate_candidate_invoice_id);
                            const confidence = row.confidence_score == null ? null : Number(row.confidence_score);
                            const readingLabel = confidence == null ? "sem leitura" : confidence >= 95 ? "leitura alta" : confidence >= 80 ? "leitura média" : "leitura baixa";
                            const readingTone = confidence == null ? "neutral" : confidence >= 95 ? "success" : confidence >= 80 ? "warn" : "error";
                            return (
                              <tr key={row.id} className={isDuplicateCandidate ? "queue-row-duplicate" : undefined}>
                                <td>
                                  <span className={`badge ${state === "review" ? "warn" : "error"}`}>{stateLabel}</span>
                                  {isDuplicateCandidate ? <span className="badge warn" style={{ marginLeft: 6 }}>duplicada?</span> : null}
                                </td>
                                <td><span className={`badge ${readingTone}`}>{readingLabel}</span></td>
                                <td>{row.vendor || "—"}</td>
                                <td>{row.invoice_number || row.filename}</td>
                                <td>{formatMoney(row.total, currency)}</td>
                                <td>{formatDate(row.created_at)}</td>
                                <td>
                                  <div className="actions-inline">
                                    <button className="upload-action-btn icon-only-btn" onClick={() => openInvoiceDetail(row)} title="Editar" aria-label="Editar">✏️</button>
                                    <button className="upload-action-btn icon-only-btn" onClick={() => void openInvoicePdfById(row.id)} title="Ver original" aria-label="Ver original">👁️</button>
                                    <button className="upload-action-btn danger icon-only-btn" onClick={() => queueInvoiceDelete(row)} title="Eliminar" aria-label="Eliminar">🗑️</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h3 style={{ marginTop: 18 }}>Processadas</h3>
                  {processedRows.length === 0 ? (
                    <div className="inline-state neutral">Ainda não existem faturas processadas para estes filtros.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Leitura</th>
                            <th>Fornecedor</th>
                            <th>Fatura</th>
                            <th>Total</th>
                            <th>Data</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {processedRows.map((row) => {
                            const currency = row.currency || "EUR";
                            const confidence = row.confidence_score == null ? null : Number(row.confidence_score);
                            const readingLabel = confidence == null ? "sem leitura" : confidence >= 95 ? "leitura alta" : confidence >= 80 ? "leitura média" : "leitura baixa";
                            const readingTone = confidence == null ? "neutral" : confidence >= 95 ? "success" : confidence >= 80 ? "warn" : "error";
                            return (
                              <tr key={row.id}>
                                <td><span className={`badge ${readingTone}`}>{readingLabel}</span></td>
                                <td>{row.vendor || "—"}</td>
                                <td>{row.invoice_number || row.filename}</td>
                                <td>{formatMoney(row.total, currency)}</td>
                                <td>{formatDate(row.created_at)}</td>
                                <td>
                                  <div className="actions-inline">
                                    <button className="upload-action-btn icon-only-btn" onClick={() => openInvoiceDetail(row)} title="Editar" aria-label="Editar">✏️</button>
                                    <button className="upload-action-btn icon-only-btn" onClick={() => void openInvoicePdfById(row.id)} title="Ver original" aria-label="Ver original">👁️</button>
                                    <button className="upload-action-btn danger icon-only-btn" onClick={() => queueInvoiceDelete(row)} title="Eliminar" aria-label="Eliminar">🗑️</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="card queue-support-failed">
              <h2>Falhas de importação</h2>
              {failedImports.length === 0 ? (
                <div className="inline-state neutral">Sem falhas pendentes.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Documento</th>
                        <th>Motivo</th>
                        <th>Tipo detetado</th>
                        <th>Tentativas</th>
                        <th>Data</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedImports.map((row) => (
                        <tr key={row.id}>
                          <td>{row.filename}</td>
                          <td>
                            <div>{row.reason}</div>
                            <div style={{ fontSize: "0.9em", opacity: 0.8, marginTop: 4 }}>{guidanceForError(row.reason)}</div>
                          </td>
                          <td>{row.detected_type || "—"}</td>
                          <td>{row.retry_count}</td>
                          <td>{formatDate(row.created_at)}</td>
                          <td>
                            <div className="actions-inline">
                              <button className="ghost-btn" onClick={() => void handleRetryFailedImport(row)}>
                                Retry
                              </button>
                              <button className="danger-btn" onClick={() => queueFailedImportDelete(row)}>
                                Remover
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {detailInvoice && (
              <div className="modal-backdrop">
                <section ref={detailSectionRef} className="card queue-detail modal-card" onClick={(event) => event.stopPropagation()}>
                  <div className="row-between">
                  <div>
                    <div className="eyebrow">Editor de fatura</div>
                    <h2>Detalhe da fatura</h2>
                    <p className="card-sub">Corrija os dados extraídos, ajuste linhas e guarde as alterações.</p>
                  </div>
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      setDetailInvoice(null);
                      setDetailForm(emptyForm());
                      setDetailLineItems([]);
                      pushToast({ type: "info", title: "Editor fechado" });
                    }}
                  >
                    Fechar
                  </button>
                  </div>

                <details open>
                  <summary>Dados principais</summary>
                  <div className="grid-3">
                    <label className="field">
                      <span>Fornecedor</span>
                      <input value={detailForm.vendor} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, vendor: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Categoria</span>
                      <input value={detailForm.category} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, category: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Número</span>
                      <input value={detailForm.invoice_number} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, invoice_number: event.target.value }))} />
                    </label>
                  </div>
                </details>

                <details>
                  <summary>Fiscal e datas</summary>
                  <div className="grid-3">
                    <label className="field">
                      <span>Data fatura</span>
                      <input value={detailForm.invoice_date} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, invoice_date: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Data vencimento</span>
                      <input value={detailForm.due_date} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, due_date: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>NIF fornecedor</span>
                      <input value={detailForm.supplier_nif} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, supplier_nif: event.target.value }))} />
                    </label>
                  </div>
                </details>

                <details>
                  <summary>Totais e notas</summary>
                  <div className="grid-3">
                    <label className="field">
                      <span>Subtotal</span>
                      <input value={detailForm.subtotal} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, subtotal: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>IVA</span>
                      <input value={detailForm.tax} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, tax: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Total</span>
                      <input value={detailForm.total} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, total: event.target.value }))} />
                    </label>
                  </div>
                  <label className="field" style={{ marginTop: 10 }}>
                    <span>Notas</span>
                    <textarea rows={3} value={detailForm.notes} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setDetailForm((prev) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                </details>

                <div className="actions-row">
                  <button className="primary-btn" onClick={() => void saveInvoiceDetail()} disabled={isSavingDetail}>
                    {isSavingDetail ? "A guardar..." : "Guardar alterações"}
                  </button>
                </div>
                <div className="inline-state neutral">Ao guardar, a fatura passa para estado <strong>corrigido</strong> e sai da revisão.</div>

                <details>
                  <summary>Linhas da fatura ({detailLineItems.length})</summary>

                  <div className="actions-row" style={{ marginTop: 8 }}>
                    <button className="ghost-btn" onClick={addDetailLineItem} type="button">
                      + Adicionar linha
                    </button>
                  </div>

                  {detailLineItems.length > 0 ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Descrição</th>
                            <th>Qtd</th>
                            <th>Preço</th>
                            <th>Subtotal</th>
                            <th>IVA</th>
                            <th>Total</th>
                            <th>Taxa %</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailLineItems.map((line, index) => (
                            <tr key={line.id ?? `new-${index}`}>
                              <td>
                                <input value={line.code} onChange={(event) => handleDetailLineItemChange(index, "code", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <textarea
                                  rows={2}
                                  value={line.description}
                                  onChange={(event) => handleDetailLineItemChange(index, "description", event.target.value)}
                                  style={{ minWidth: 220, width: "100%", resize: "vertical" }}
                                />
                              </td>
                              <td>
                                <input value={line.quantity} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "quantity", event.target.value)} style={{ width: 70 }} />
                              </td>
                              <td>
                                <input value={line.unit_price} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "unit_price", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_subtotal} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "line_subtotal", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_tax_amount} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "line_tax_amount", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_total} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "line_total", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.tax_rate} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => handleDetailLineItemChange(index, "tax_rate", event.target.value)} style={{ width: 70 }} />
                              </td>
                              <td>
                                <div className="actions-inline">
                                  <button className="ghost-btn icon-only-btn" type="button" onClick={() => insertDetailLineItemAt(index)} title="Inserir acima" aria-label="Inserir acima">
                                    ⤒
                                  </button>
                                  <button className="ghost-btn icon-only-btn" type="button" onClick={() => insertDetailLineItemAt(index + 1)} title="Inserir abaixo" aria-label="Inserir abaixo">
                                    ⤓
                                  </button>
                                  <button className="danger-btn icon-only-btn" type="button" onClick={() => removeDetailLineItem(index)} title="Remover linha" aria-label="Remover linha">
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="inline-state neutral">Sem linhas extraídas. Pode adicionar manualmente.</div>
                  )}
                </details>
                </section>
              </div>
            )}
            <section className="card queue-support-review">
              <details>
                <summary>Revisão e bloqueios ({reviewLineItems.length} linhas, {automationBlockers.length} bloqueios)</summary>
                <p className="card-sub">Detalhes técnicos para validar o que ainda precisa de correção.</p>
                <div className="telemetry-grid">
                  <div>
                    <div className="telemetry-label">Linhas em revisão</div>
                    <div className="telemetry-value">{reviewLineItems.length}</div>
                  </div>
                  <div>
                    <div className="telemetry-label">Bloqueios</div>
                    <div className="telemetry-value">{automationBlockers.length}</div>
                  </div>
                </div>

                <div className="inline-state neutral" style={{ marginTop: 10 }}>
                  Para remover da lista: abra a fatura, corrija os campos/linhas e guarde. O item sai automaticamente da revisão.
                </div>

                <h3 style={{ marginTop: 14 }}>Linhas em revisão</h3>
              {reviewLineItems.length === 0 ? (
                <div className="inline-state success">Sem linhas pendentes de revisão.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fatura</th>
                        <th>Fornecedor</th>
                        <th>Linha</th>
                        <th>Motivo</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewLineItems.slice(0, 20).map((line) => (
                        <tr key={line.line_item_id}>
                          <td>{line.invoice_number || line.filename}</td>
                          <td>{line.vendor || "—"}</td>
                          <td>{line.description || "—"}</td>
                          <td>{line.review_reason || "Revisão manual"}</td>
                          <td>
                            <button className="ghost-btn" onClick={() => void openInvoicePdfById(line.invoice_id)} title="Abrir PDF da fatura">
                              👁️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

                <h3 style={{ marginTop: 14 }}>Bloqueios</h3>
                {automationBlockers.length === 0 ? (
                  <div className="inline-state success">Sem bloqueios de automação no recorte atual.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fatura</th>
                          <th>Código</th>
                          <th>Mensagem</th>
                          <th>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {automationBlockers.slice(0, 20).map((blocker, index) => (
                          <tr key={`${blocker.invoice_id}-${index}`}>
                            <td>{blocker.invoice_number || blocker.filename}</td>
                            <td>{blocker.code}</td>
                            <td>{blocker.message}</td>
                            <td>
                              <button className="ghost-btn" onClick={() => void openInvoicePdfById(blocker.invoice_id)} title="Abrir PDF da fatura">
                                👁️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </section>

          </>
        )}

        {activeTab === "search" && (
          <>
            <section className="card">
              <h2>Pesquisa rápida</h2>
              <p className="card-sub">Use <kbd>/</kbd> para focar esta caixa em qualquer lugar.</p>

              <label className="field">
                <span>Pesquisar faturas</span>
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="fornecedor, nº fatura, ficheiro..."
                />
              </label>

              {searchResults.length === 0 ? (
                <div className="inline-state neutral">Sem resultados para esta pesquisa.</div>
              ) : (
                <div className="result-grid">
                  {searchResults.map((row) => (
                    <button key={row.id} className="result-card" onClick={() => openInvoiceDetail(row)}>
                      <div className="result-title">{row.invoice_number || row.filename}</div>
                      <div className="result-meta">{row.vendor || "Fornecedor desconhecido"}</div>
                      <div className="result-meta">{formatMoney(row.total, row.currency || "EUR")} · {formatDate(row.created_at)}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>

          </>
        )}
          </main>
        </>
      )}

      {duplicateReview ? (
        <div className="modal-backdrop" onClick={() => setDuplicateReview(null)}>
          <section className="card modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="row-between">
              <div>
                <div className="eyebrow">Possível duplicado</div>
                <h2>Esta fatura parece ser duplicada</h2>
                <p className="card-sub">Compare a nova fatura com a já existente e escolha como quer continuar.</p>
              </div>
              <button className="ghost-btn" onClick={() => setDuplicateReview(null)}>Fechar</button>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="inline-state warn">
                <strong>Nova fatura</strong>
                <div>{duplicateReview.uploaded.filename}</div>
                <div>{duplicateReview.uploaded.vendor || "—"}</div>
                <div>{duplicateReview.uploaded.invoice_number || "—"}</div>
              </div>
              <div className="inline-state neutral">
                <strong>Fatura existente</strong>
                <div>ID: {duplicateReview.existingId}</div>
              </div>
            </div>

            <div className="actions-row" style={{ marginTop: 16 }}>
              <button className="ghost-btn" onClick={() => void openInvoicePdfById(duplicateReview.uploaded.id)}>
                Ver nova fatura
              </button>
              <button className="ghost-btn" onClick={() => void openInvoicePdfById(duplicateReview.existingId)}>
                Ver fatura existente
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setDuplicateReview(null);
                  openInvoiceById(duplicateReview.uploaded.id);
                }}
              >
                Guardar como nova
              </button>
              <button
                className="danger-btn"
                onClick={() => {
                  queueInvoiceDelete(duplicateReview.uploaded);
                  setDuplicateReview(null);
                }}
              >
                Marcar como duplicada e descartar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <aside className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <div className="toast-title">{toast.title}</div>
            {toast.detail ? <div className="toast-detail">{toast.detail}</div> : null}
            <div className="toast-actions">
              {toast.actionLabel && toast.onAction ? (
                <button
                  className="ghost-btn"
                  onClick={() => {
                    toast.onAction?.();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.actionLabel}
                </button>
              ) : null}
              <button className="ghost-btn" onClick={() => dismissToast(toast.id)}>
                Fechar
              </button>
            </div>
          </div>
        ))}
      </aside>

      <footer className="action-bar">
        <div>
          <div className="action-title">Ação principal</div>
          <div className="action-sub">
            {activeTab === "upload"
              ? "Envia documentos e atualiza queue"
              : activeTab === "queue"
                ? "Recarrega queue/falhas/revisão"
                : "Foca pesquisa global"}
          </div>
        </div>
        <button className="primary-btn" onClick={primaryAction} disabled={isUploading || isQueueLoading}>
          {primaryActionLabel}
        </button>
      </footer>
    </div>
  );
}
