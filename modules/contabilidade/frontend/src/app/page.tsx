"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Use basePath-prefixed path so browser requests go through Next.js server-side rewrite
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
  if (lowered.includes("tenant")) return "Defina um tenant válido (ex.: demo) antes de continuar.";
  if (lowered.includes("selecione") || lowered.includes("ficheiro")) return "Adicione pelo menos um PDF/JPG/PNG e tente novamente.";
  if (lowered.includes("network") || lowered.includes("failed to fetch")) {
    return "Confirme backend ativo em /api/health e ligação entre frontend/backend.";
  }
  if (lowered.includes("zip")) return "Verifique ZIP (máx 200 ficheiros, 20MB por ficheiro, 100MB total).";
  return "Revise os campos destacados e tente novamente.";
}

function getStageLabel(step: UploadStep) {
  if (step === "validate") return "Validate";
  if (step === "extract") return "Extract";
  if (step === "review") return "Review";
  return "Save";
}

export default function Home() {
  const apiBase = API_BASE;

  const [activeTab, setActiveTab] = useState<TabKey>("upload");
  const [tenantId, setTenantId] = useState("demo");
  const [tenantProfile, setTenantProfile] = useState<TenantProfile>({ company_name: "", company_nif: "" });

  const [rows, setRows] = useState<Invoice[]>([]);
  const [failedImports, setFailedImports] = useState<FailedImportRow[]>([]);
  const [reviewLineItems, setReviewLineItems] = useState<ReviewLineItem[]>([]);
  const [automationBlockers, setAutomationBlockers] = useState<AutomationBlocker[]>([]);

  const [files, setFiles] = useState<FileList | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadStage, setUploadStage] = useState<"idle" | UploadStep | "done" | "error">("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");

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
  }, []);

  const openInvoiceById = useCallback(
    (invoiceId: string) => {
      const target = rows.find((row) => row.id === invoiceId);
      if (!target) {
        pushToast({ type: "error", title: "Fatura não encontrada", detail: invoiceId });
        return;
      }
      openInvoiceDetail(target);
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
      setDetailInvoice(null);
      setDetailForm(emptyForm());
      setDetailLineItems([]);
      pushToast({ type: "success", title: "Fatura guardada", detail: data.invoice_number || data.filename });
      await refreshQueueData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao guardar alterações";
      pushToast({ type: "error", title: "Erro ao guardar", detail: `${message}. ${guidanceForError(message)}` });
    } finally {
      setIsSavingDetail(false);
    }
  }, [detailInvoice, detailForm, detailLineItems, apiBase, refreshQueueData, pushToast, tenantId]);

  const commitInvoiceDelete = useCallback(
    async (invoiceId: string) => {
      const pending = pendingInvoiceDeleteRef.current[invoiceId];
      if (!pending) return;
      try {
        const response = await fetch(`${apiBase}/api/invoices/${invoiceId}`, {
          method: "DELETE",
          headers: { "X-Tenant-Id": tenantId },
        });
        if (!response.ok) {
          const data = await parseResponse(response);
          throw new Error(data?.detail || "Falha ao apagar fatura");
        }
        if (detailInvoice?.id === invoiceId) {
          setDetailInvoice(null);
          setDetailForm(emptyForm());
          setDetailLineItems([]);
        }
        pushToast({ type: "success", title: "Fatura apagada", detail: pending.invoice.filename });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao apagar fatura";
        setRows((prev) => [pending.invoice, ...prev]);
        pushToast({ type: "error", title: "Não foi possível apagar", detail: `${message}. ${guidanceForError(message)}` });
      } finally {
        delete pendingInvoiceDeleteRef.current[invoiceId];
      }
    },
    [apiBase, detailInvoice, pushToast, tenantId]
  );

  const undoInvoiceDelete = useCallback(
    (invoiceId: string) => {
      const pending = pendingInvoiceDeleteRef.current[invoiceId];
      if (!pending) return;
      window.clearTimeout(pending.timeoutId);
      setRows((prev) => [pending.invoice, ...prev]);
      delete pendingInvoiceDeleteRef.current[invoiceId];
      pushToast({ type: "info", title: "Apagamento revertido", detail: pending.invoice.filename });
    },
    [pushToast]
  );

  const queueInvoiceDelete = useCallback(
    (invoice: Invoice) => {
      const confirmed = window.confirm(`Apagar fatura ${invoice.invoice_number || invoice.filename}?`);
      if (!confirmed) return;

      setRows((prev) => prev.filter((row) => row.id !== invoice.id));
      setSelectedInvoiceIds((prev) => prev.filter((id) => id !== invoice.id));

      const timeoutId = window.setTimeout(() => {
        void commitInvoiceDelete(invoice.id);
      }, 5000);

      pendingInvoiceDeleteRef.current[invoice.id] = { invoice, timeoutId };
      pushToast(
        {
          type: "info",
          title: "Fatura agendada para apagamento",
          detail: "Ação destrutiva com janela de Undo de 5s.",
          actionLabel: "Undo",
          onAction: () => undoInvoiceDelete(invoice.id),
        },
        5200
      );
    },
    [commitInvoiceDelete, undoInvoiceDelete, pushToast]
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
    setTelemetry((prev) => ({ ...prev, started: prev.started + 1 }));

    let currentStep: UploadStep = "validate";

    try {
      setUploadStage("validate");
      bumpUploadStep("validate");
      void sendUploadTelemetryEvent("validate", "enter", "upload_started");

      const selectedFiles = Array.from(files);
      const aggregated = { ingested: [] as unknown[], rejected: [] as Array<{ filename: string; reason: string; detected_type?: string }> };

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
        } catch (fileError) {
          const storageReason = fileError instanceof Error ? fileError.message : "Falha no upload para storage";
          try {
            // Fallback path when direct-to-storage fails (e.g. missing R2 CORS from browser).
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
          } catch (fallbackError) {
            const fallbackReason = fallbackError instanceof Error ? fallbackError.message : "Falha no fallback ingest";
            const reason = `${storageReason}; fallback: ${fallbackReason}`;
            aggregated.rejected.push({ filename: file.name, reason, detected_type: "storage_upload_error" });
          }
        }
      }

      currentStep = "review";
      setUploadStage("review");
      bumpUploadStep("review");
      void sendUploadTelemetryEvent("review", "enter");

      const ingestedCount = aggregated.ingested.length;
      const rejectedCount = aggregated.rejected.length;

      currentStep = "save";
      setUploadStage("save");
      bumpUploadStep("save");
      void sendUploadTelemetryEvent("save", "enter");

      const message = `Processados ${ingestedCount} documento(s)${rejectedCount ? ` · ${rejectedCount} rejeitado(s)` : ""}.`;
      setUploadSuccess(message);
      setFiles(null);
      setFileInputKey((prev) => prev + 1);

      setTelemetry((prev) => ({ ...prev, completed: prev.completed + 1 }));
      void sendUploadTelemetryEvent("save", "success", `ingested:${ingestedCount};rejected:${rejectedCount}`);
      pushToast({ type: "success", title: "Upload concluído", detail: message });

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
    void fetchTenantProfile();
    void refreshQueueData();
    void fetchSystemHealth();
    void fetchUploadTelemetrySummary();
  }, [fetchTenantProfile, refreshQueueData, fetchSystemHealth, fetchUploadTelemetrySummary]);

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

  const queueSummary = useMemo(() => {
    const review = rows.filter((row) => invoiceQueueState(row) === "review").length;
    const errors = rows.filter((row) => invoiceQueueState(row) === "error").length;
    const processed = rows.filter((row) => invoiceQueueState(row) === "processed").length;
    return { total: rows.length, review, errors, processed };
  }, [rows]);

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
          <p className="eyebrow">Módulo de Contabilidade</p>
          <h1>Gestão de Faturas</h1>
          <p className="subtext">Upload, classificação automática e pesquisa inteligente de documentos fiscais.</p>
        </div>
        <div className="shortcut-hints">Atalhos: <kbd>/</kbd> Search · <kbd>u</kbd> Upload · <kbd>g</kbd> <kbd>q</kbd> Queue</div>
      </header>

      <section className="status-strip">
        {renderStatusPill("API", health.api, health.api === "ok" ? "online" : "offline")}
        {renderStatusPill("DB", health.db, health.db === "ok" ? "ready" : "indisponível")}
        {renderStatusPill("OCR", health.ocr, health.ocrDetail)}
        <button className="ghost-btn" onClick={() => void fetchSystemHealth()}>
          Atualizar estado
        </button>
      </section>

      <nav className="tabs-nav" aria-label="Navegação principal">
        <button className={activeTab === "upload" ? "tab active" : "tab"} onClick={() => setActiveTab("upload")}>
          Upload
        </button>
        <button className={activeTab === "queue" ? "tab active" : "tab"} onClick={() => setActiveTab("queue")}>
          Queue
        </button>
        <button className={activeTab === "search" ? "tab active" : "tab"} onClick={() => setActiveTab("search")}>
          Search
        </button>
      </nav>

      <main className="content-grid">
        {activeTab === "upload" && (
          <>
            <section className="card">
              <h2>Fluxo de upload</h2>
              <p className="card-sub">Validate → Extract → Review → Save com feedback em tempo real.</p>

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

              <div className="grid-2">
                <label className="field">
                  <span>Tenant</span>
                  <input
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="ex: demo"
                    disabled={isUploading}
                  />
                </label>

                <label className="field">
                  <span>Documentos (PDF/JPG/PNG/ZIP)</span>
                  <input
                    key={fileInputKey}
                    type="file"
                    multiple
                    onChange={(event) => setFiles(event.target.files)}
                    disabled={isUploading}
                  />
                </label>
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
                  }}
                  disabled={isUploading}
                >
                  Limpar seleção
                </button>
              </div>

              {uploadError ? <div className="inline-state error">{uploadError}</div> : null}
              {uploadSuccess ? <div className="inline-state success">{uploadSuccess}</div> : null}
              {!uploadError && !uploadSuccess ? (
                <div className="inline-state neutral">Sem upload recente. Adicione ficheiros e clique em “Processar faturas agora”.</div>
              ) : null}
            </section>

            <section className="card">
              <h2>Configuração do tenant</h2>
              <p className="card-sub">Formulário em grupos, com disclosure progressivo para campos menos usados.</p>

              <div className="grid-2">
                <label className="field">
                  <span>Nome da empresa</span>
                  <input
                    value={tenantProfile.company_name ?? ""}
                    onChange={(event) => setTenantProfile((prev) => ({ ...prev, company_name: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>NIF da empresa</span>
                  <input
                    value={tenantProfile.company_nif ?? ""}
                    onChange={(event) => setTenantProfile((prev) => ({ ...prev, company_nif: event.target.value }))}
                  />
                </label>
              </div>

              <details>
                <summary>Mostrar opções avançadas</summary>
                <div className="inline-state neutral">
                  Perfil influencia defaults de extração (customer_name / customer_nif) e melhora consistência.
                </div>
              </details>

              <div className="actions-row">
                <button className="primary-btn" onClick={() => void saveTenantProfile()} disabled={isSavingTenantProfile}>
                  {isSavingTenantProfile ? "A guardar..." : "Guardar perfil"}
                </button>
                <button className="ghost-btn" onClick={() => void fetchTenantProfile()}>
                  Recarregar perfil
                </button>
              </div>
            </section>

            <section className="card">
              <h2>Telemetry de fricção (upload funnel)</h2>
              <p className="card-sub">Drop-off por etapa para guiar próximas melhorias de UX.</p>

              <div className="telemetry-grid">
                <div>
                  <div className="telemetry-label">Iniciados</div>
                  <div className="telemetry-value">{telemetry.started}</div>
                </div>
                <div>
                  <div className="telemetry-label">Concluídos</div>
                  <div className="telemetry-value">{telemetry.completed}</div>
                </div>
                <div>
                  <div className="telemetry-label">Falhados</div>
                  <div className="telemetry-value">{telemetry.failed}</div>
                </div>
                <div>
                  <div className="telemetry-label">Taxa sucesso</div>
                  <div className="telemetry-value">
                    {telemetry.started > 0 ? `${((telemetry.completed / telemetry.started) * 100).toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>

              <div className="inline-list">
                <div>Drop em Validate: <strong>{stepDropoff.validateDrop}</strong></div>
                <div>Drop em Extract: <strong>{stepDropoff.extractDrop}</strong></div>
                <div>Drop em Review: <strong>{stepDropoff.reviewDrop}</strong></div>
                <div>Drop em Save: <strong>{stepDropoff.saveDrop}</strong></div>
              </div>

              <div className="actions-row">
                <button className="ghost-btn" onClick={() => void fetchUploadTelemetrySummary()}>
                  Atualizar telemetria do servidor (72h)
                </button>
              </div>

              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Enter</th>
                      <th>Success</th>
                      <th>Failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {UPLOAD_STEPS.map((step) => (
                      <tr key={step}>
                        <td>{getStageLabel(step)}</td>
                        <td>{serverFunnel[step].enter}</td>
                        <td>{serverFunnel[step].success}</td>
                        <td>{serverFunnel[step].failure}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === "queue" && (
          <>
            <section className="card">
              <div className="row-between">
                <div>
                  <h2>Queue de faturas</h2>
                  <p className="card-sub">Filtros + ordenação + bulk actions para reduzir cliques.</p>
                </div>
                <div className="badge-row">
                  <span className="badge neutral">total {queueSummary.total}</span>
                  <span className="badge warn">review {queueSummary.review}</span>
                  <span className="badge success">processadas {queueSummary.processed}</span>
                  <span className="badge error">erros {queueSummary.errors}</span>
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
                  {isQueueLoading ? "A atualizar..." : "Atualizar queue"}
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
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedInvoiceIds(queueRows.map((row) => row.id));
                              } else {
                                setSelectedInvoiceIds([]);
                              }
                            }}
                            aria-label="Selecionar todos"
                          />
                        </th>
                        <th>Estado</th>
                        <th>Fornecedor</th>
                        <th>Fatura</th>
                        <th>Total</th>
                        <th>Confiança</th>
                        <th>Data</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueRows.map((row) => {
                        const state = invoiceQueueState(row);
                        const stateLabel = state === "review" ? "review" : state === "error" ? "erro" : "ok";
                        const currency = row.currency || "EUR";
                        const isDuplicateCandidate = String(row.notes || "").includes("DUPLICATE_CANDIDATE");

                        return (
                          <tr key={row.id} className={isDuplicateCandidate ? "queue-row-duplicate" : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedInvoiceIds.includes(row.id)}
                                onChange={(event) => {
                                  setSelectedInvoiceIds((prev) => {
                                    if (event.target.checked) return [...prev, row.id];
                                    return prev.filter((id) => id !== row.id);
                                  });
                                }}
                                aria-label={`Selecionar ${row.filename}`}
                              />
                            </td>
                            <td>
                              <span className={`badge ${state === "review" ? "warn" : state === "error" ? "error" : "success"}`}>{stateLabel}</span>
                              {isDuplicateCandidate ? <span className="badge warn" style={{ marginLeft: 6 }}>duplicada?</span> : null}
                            </td>
                            <td>{row.vendor || "—"}</td>
                            <td>{row.invoice_number || row.filename}</td>
                            <td>{formatMoney(row.total, currency)}</td>
                            <td>{row.confidence_score == null ? "—" : `${Number(row.confidence_score).toFixed(1)}%`}</td>
                            <td>{formatDate(row.created_at)}</td>
                            <td>
                              <div className="actions-inline">
                                <button className="ghost-btn" onClick={() => openInvoiceDetail(row)}>
                                  Abrir e editar
                                </button>
                                <button className="danger-btn" onClick={() => queueInvoiceDelete(row)}>
                                  Apagar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                        <th>Tentativas</th>
                        <th>Data</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedImports.map((row) => (
                        <tr key={row.id}>
                          <td>{row.filename}</td>
                          <td>{row.reason}</td>
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

            <section className="card queue-support-review">
              <h2>Revisão e bloqueios</h2>
              <p className="card-sub">Mostra exatamente o que está pendente e permite abrir a fatura para limpar.</p>
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
            </section>

            {detailInvoice && (
              <section ref={detailSectionRef} className="card queue-detail">
                <div className="row-between">
                  <div>
                    <h2>Detalhe da fatura</h2>
                    <p className="card-sub">Campos agrupados + disclosure para reduzir densidade.</p>
                  </div>
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      setDetailInvoice(null);
                      setDetailForm(emptyForm());
                      setDetailLineItems([]);
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
                      <input value={detailForm.vendor} onChange={(event) => setDetailForm((prev) => ({ ...prev, vendor: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Categoria</span>
                      <input value={detailForm.category} onChange={(event) => setDetailForm((prev) => ({ ...prev, category: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Número</span>
                      <input value={detailForm.invoice_number} onChange={(event) => setDetailForm((prev) => ({ ...prev, invoice_number: event.target.value }))} />
                    </label>
                  </div>
                </details>

                <details>
                  <summary>Fiscal e datas</summary>
                  <div className="grid-3">
                    <label className="field">
                      <span>Data fatura</span>
                      <input value={detailForm.invoice_date} onChange={(event) => setDetailForm((prev) => ({ ...prev, invoice_date: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Data vencimento</span>
                      <input value={detailForm.due_date} onChange={(event) => setDetailForm((prev) => ({ ...prev, due_date: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>NIF fornecedor</span>
                      <input value={detailForm.supplier_nif} onChange={(event) => setDetailForm((prev) => ({ ...prev, supplier_nif: event.target.value }))} />
                    </label>
                  </div>
                </details>

                <details>
                  <summary>Totais e notas</summary>
                  <div className="grid-3">
                    <label className="field">
                      <span>Subtotal</span>
                      <input value={detailForm.subtotal} onChange={(event) => setDetailForm((prev) => ({ ...prev, subtotal: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>IVA</span>
                      <input value={detailForm.tax} onChange={(event) => setDetailForm((prev) => ({ ...prev, tax: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span>Total</span>
                      <input value={detailForm.total} onChange={(event) => setDetailForm((prev) => ({ ...prev, total: event.target.value }))} />
                    </label>
                  </div>
                  <label className="field" style={{ marginTop: 10 }}>
                    <span>Notas</span>
                    <textarea rows={3} value={detailForm.notes} onChange={(event) => setDetailForm((prev) => ({ ...prev, notes: event.target.value }))} />
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
                            <th>Ação</th>
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
                                <input value={line.quantity} onChange={(event) => handleDetailLineItemChange(index, "quantity", event.target.value)} style={{ width: 70 }} />
                              </td>
                              <td>
                                <input value={line.unit_price} onChange={(event) => handleDetailLineItemChange(index, "unit_price", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_subtotal} onChange={(event) => handleDetailLineItemChange(index, "line_subtotal", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_tax_amount} onChange={(event) => handleDetailLineItemChange(index, "line_tax_amount", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.line_total} onChange={(event) => handleDetailLineItemChange(index, "line_total", event.target.value)} style={{ width: 90 }} />
                              </td>
                              <td>
                                <input value={line.tax_rate} onChange={(event) => handleDetailLineItemChange(index, "tax_rate", event.target.value)} style={{ width: 70 }} />
                              </td>
                              <td>
                                <button className="danger-btn" type="button" onClick={() => removeDetailLineItem(index)}>
                                  Remover
                                </button>
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
            )}
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

            <section className="card">
              <h2>Search assistida (chat)</h2>
              <p className="card-sub">Perguntas em linguagem natural com referências de faturas.</p>

              <div className="chat-box">
                {chatHistory.length === 0 ? (
                  <div className="inline-state neutral">Sem conversas ainda. Ex.: “Quanto gastei com Via Oceânica este mês?”</div>
                ) : (
                  chatHistory.map((message) => (
                    <div key={message.id} className={`chat-message ${message.role}`}>
                      <div>{message.text}</div>
                      {message.references && message.references.length > 0 ? (
                        <div className="chat-ref">
                          {message.references.map((reference) => (
                            <span key={`${message.id}-${reference.invoice_id}`}>
                              #{reference.invoice_number ?? reference.invoice_id.slice(0, 8)} ({reference.vendor ?? "Fornecedor"})
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
                {isChatLoading ? <div className="chat-loading">A pensar...</div> : null}
              </div>

              {chatError ? <div className="inline-state error">{chatError}</div> : null}

              <label className="field">
                <span>Pergunta</span>
                <textarea
                  rows={3}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Pergunte sobre totais, fornecedores, IVA, etc."
                  disabled={isChatLoading}
                />
              </label>

              <div className="actions-row">
                <button className="primary-btn" onClick={() => void handleSendChat()} disabled={isChatLoading || !chatInput.trim()}>
                  {isChatLoading ? "A pensar..." : "Perguntar"}
                </button>
              </div>
            </section>
          </>
        )}
      </main>

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
