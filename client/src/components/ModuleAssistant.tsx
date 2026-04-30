/**
 * ModuleAssistant — Floating chat widget for module-specific AI assistants
 * Uses the AIChatBox component internally and communicates via /api/ai/agent/chat
 * Supports file export: renders download links when the agent generates files
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { MessageCircle, X, Trash2, Minus, Sparkles, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { useAgentChat, type ExportedFile } from "@/hooks/useAgentChat";

const EMAIL_ASSISTANT_CONTEXT_EVENT = "viao-email-assistant-context";

type EmailAssistantUiContext = {
  selectedEmailId?: string;
  selectedEmailIds?: string[];
  selectedMailboxId?: string;
  selectedFolder?: string;
  selectedEmail?: {
    id?: string;
    subject?: string;
    from?: string;
    fromAddress?: string;
    toAddresses?: string;
    folder?: string;
    receivedAt?: string;
    snippet?: string;
    bodyPreview?: string;
    isSeen?: boolean;
    isFlagged?: boolean;
    hasAttachments?: boolean;
  } | null;
} | null;

const AGENT_NAMES: Record<string, { name: string; emoji: string; greeting: string }> = {
  contabilidade: {
    name: "Assistente Contabilidade",
    emoji: "📊",
    greeting: "Olá! Sou o assistente de contabilidade. Posso ajudar com SNC, IVA, IRS, IRC e questões fiscais portuguesas. Também posso exportar relatórios e classificações para ficheiro.",
  },
  helpdesk: {
    name: "Assistente Helpdesk",
    emoji: "🎫",
    greeting: "Olá! Sou o assistente de helpdesk. Posso ajudar com triagem de tickets, SLAs, prioridades, respostas a clientes e organização da operação de suporte.",
  },
  email: {
    name: "Assistente Email",
    emoji: "✉️",
    greeting: "Olá! Sou o assistente de email. Posso ajudar com campanhas, automações, segmentação, follow-up comercial e operação de caixas de entrada.",
  },
  platform: {
    name: "Assistente Via Oceânica",
    emoji: "🌊",
    greeting: "Olá! Sou o assistente da Via Oceânica. Como posso ajudar?",
  },
};

interface ModuleAssistantProps {
  moduleKey?: string;
}

/**
 * FileDownloadCard — Renders a download link for an exported file
 */
function FileDownloadCard({ file }: { file: ExportedFile }) {
  const handleDownload = () => {
    // Use the gateway-proxied URL
    const url = file.downloadUrl.startsWith("/api/v1/")
      ? file.downloadUrl.replace("/api/v1/", "/api/ai/")
      : file.downloadUrl;
    window.open(url, "_blank");
  };

  return (
    <button
      onClick={handleDownload}
      className="mt-2 flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700 transition-colors hover:bg-teal-100 hover:border-teal-300 w-full text-left"
    >
      <FileText className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 truncate font-medium">{file.filename}</span>
      <Download className="h-4 w-4 flex-shrink-0" />
    </button>
  );
}

export function ModuleAssistant({ moduleKey = "platform" }: ModuleAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [emailContext, setEmailContext] = useState<EmailAssistantUiContext>(null);
  const { messages, isLoading, quota, sendMessage, clearHistory, fetchQuota } = useAgentChat({
    moduleKey,
    getRequestContext: () => moduleKey === "email" && emailContext ? { emailContext } : undefined,
  });

  const agent = AGENT_NAMES[moduleKey] || AGENT_NAMES.platform;

  useEffect(() => {
    if (moduleKey !== "email" || typeof window === "undefined") return;

    const current = (window as Window & { __viaEmailAssistantContext?: EmailAssistantUiContext }).__viaEmailAssistantContext;
    if (current) {
      setEmailContext(current);
    }

    const handleContext = (event: Event) => {
      const customEvent = event as CustomEvent<EmailAssistantUiContext>;
      setEmailContext(customEvent.detail || null);
    };

    window.addEventListener(EMAIL_ASSISTANT_CONTEXT_EVENT, handleContext as EventListener);
    return () => {
      window.removeEventListener(EMAIL_ASSISTANT_CONTEXT_EVENT, handleContext as EventListener);
    };
  }, [moduleKey]);

  // Fetch quota when widget opens
  useEffect(() => {
    if (isOpen) {
      fetchQuota();
    }
  }, [isOpen, fetchQuota]);

  // Convert useAgentChat messages to AIChatBox format
  // Also build a map of files per message index for rendering
  const { chatMessages, filesByIndex } = useMemo(() => {
    const chatMsgs: Message[] = [];
    const filesMap: Record<number, ExportedFile[]> = {};

    messages.forEach((m, idx) => {
      chatMsgs.push({
        role: m.role === "system" ? "assistant" : m.role,
        content: m.content,
      });
      if (m.files && m.files.length > 0) {
        filesMap[idx] = m.files;
      }
    });

    return { chatMessages: chatMsgs, filesByIndex: filesMap };
  }, [messages]);

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage]
  );

  const handleClear = useCallback(async () => {
    await clearHistory();
  }, [clearHistory]);

  const selectedEmailSummary = emailContext?.selectedEmail || null;
  const selectedEmailCount = Math.max(emailContext?.selectedEmailIds?.length || 0, selectedEmailSummary?.id ? 1 : 0);

  const assistantShortcuts = useMemo(() => {
    if (moduleKey !== "email" || selectedEmailCount === 0) return [] as string[];
    if (selectedEmailCount > 1) {
      return [
        "Resume os emails selecionados",
        "Arquiva os emails selecionados",
        "Marca os emails selecionados como lidos",
        "Apaga os emails selecionados",
      ];
    }
    return [
      "Resume o email aberto",
      "Rascunha uma resposta curta e profissional a este email",
      "Rascunha uma resposta simpática e curta a este email",
      "Rascunha uma resposta firme e objetiva a este email",
      "Arquiva este email",
      "Marca este email como importante",
    ];
  }, [moduleKey, selectedEmailCount, selectedEmailSummary]);

  // Render file download cards after the chat box for messages with files
  const fileCards = useMemo(() => {
    const cards: ExportedFile[] = [];
    Object.values(filesByIndex).forEach((files) => {
      cards.push(...files);
    });
    return cards;
  }, [filesByIndex]);

  // FAB button when closed
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsOpen(true)}
          className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-white shadow-lg transition-all hover:shadow-xl hover:scale-105 active:scale-95"
          title={`Abrir ${agent.name}`}
        >
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm font-medium hidden sm:inline">
            {agent.emoji} Assistente AI
          </span>
        </button>
      </div>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-white shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">
            {agent.emoji} {messages.length > 0 ? `${messages.length} msgs` : "Assistente"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.emoji}</span>
          <div>
            <h3 className="text-sm font-semibold">{agent.name}</h3>
            {quota && !quota.unlimited && (
              <p className="text-xs text-teal-100">
                {quota.remaining.toLocaleString("pt-PT")} tokens restantes ({quota.percentage_used}% usado)
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={handleClear}
            title="Limpar conversa"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={() => setIsMinimized(true)}
            title="Minimizar"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={() => setIsOpen(false)}
            title="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Quota warning bar */}
      {quota && !quota.unlimited && quota.percentage_used >= 80 && (
        <div className={`px-3 py-1.5 text-xs font-medium ${
          quota.percentage_used >= 100
            ? "bg-red-50 text-red-700"
            : "bg-amber-50 text-amber-700"
        }`}>
          {quota.percentage_used >= 100
            ? "⚠️ Quota de tokens excedida. Contacte o administrador."
            : `⚠️ ${quota.percentage_used}% da quota utilizada este mês.`}
        </div>
      )}

      {moduleKey === "email" && selectedEmailCount > 0 && (
        <div className="border-b border-gray-100 bg-emerald-50/70 px-3 py-2">
          <p className="text-xs font-medium text-emerald-800">
            {selectedEmailCount > 1 ? `A usar ${selectedEmailCount} emails selecionados como contexto` : "A usar o email aberto como contexto"}
          </p>
          <p className="truncate text-xs text-emerald-700">
            {selectedEmailCount > 1
              ? `${selectedEmailSummary?.subject || "(Sem assunto)"} · ${selectedEmailSummary?.from || "Remetente desconhecido"} · +${selectedEmailCount - 1} selecionado(s)`
              : `${selectedEmailSummary?.subject || "(Sem assunto)"} · ${selectedEmailSummary?.from || "Remetente desconhecido"}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {assistantShortcuts.map((shortcut) => (
              <button
                key={shortcut}
                type="button"
                onClick={() => handleSend(shortcut)}
                className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                {shortcut}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat body */}
      <AIChatBox
        messages={chatMessages}
        onSendMessage={handleSend}
        isLoading={isLoading}
        placeholder={`Pergunte ao ${agent.name.toLowerCase()}...`}
        height={420}
        emptyStateMessage={agent.greeting}
        suggestedPrompts={getSuggestedPrompts(moduleKey)}
        className="border-0 rounded-none shadow-none"
      />

      {/* File download cards — shown at the bottom when files are available */}
      {fileCards.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-2 max-h-[120px] overflow-y-auto">
          <p className="text-xs text-gray-500 mb-1 font-medium">📎 Ficheiros exportados:</p>
          {fileCards.map((file) => (
            <FileDownloadCard key={file.id} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}

function getSuggestedPrompts(moduleKey: string): string[] {
  switch (moduleKey) {
    case "contabilidade":
      return [
        "Como classifico uma fatura de material de escritório no SNC?",
        "Qual a taxa de IVA para serviços de consultoria?",
        "Exporta uma tabela com as contas SNC mais comuns",
      ];
    case "helpdesk":
      return [
        "Como devo priorizar tickets urgentes vs normais?",
        "Que regras de SLA devo aplicar para incidentes críticos?",
        "Ajuda-me a escrever uma resposta clara para um cliente sobre atraso",
      ];
    case "email":
      return [
        "Ajuda-me a criar uma sequência de follow-up comercial",
        "Como devo segmentar uma campanha para leads quentes?",
        "Escreve um email curto para reativar contactos frios",
      ];
    default:
      return [
        "O que é a plataforma Via Oceânica?",
        "Como posso gerir a minha equipa?",
        "Quais módulos estão disponíveis?",
      ];
  }
}
