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

const AGENT_NAMES: Record<string, { name: string; emoji: string; greeting: string }> = {
  contabilidade: {
    name: "Assistente Contabilidade",
    emoji: "📊",
    greeting: "Olá! Sou o assistente de contabilidade. Posso ajudar com SNC, IVA, IRS, IRC e questões fiscais portuguesas. Também posso exportar relatórios e classificações para ficheiro.",
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
  const { messages, isLoading, quota, sendMessage, clearHistory, fetchQuota } = useAgentChat({
    moduleKey,
  });

  const agent = AGENT_NAMES[moduleKey] || AGENT_NAMES.platform;

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
    default:
      return [
        "O que é a plataforma Via Oceânica?",
        "Como posso gerir a minha equipa?",
        "Quais módulos estão disponíveis?",
      ];
  }
}
