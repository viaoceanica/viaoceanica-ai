/**
 * useAgentChat — Hook for communicating with module-specific OpenClaw agents
 * via the ai-service /api/v1/agent/chat endpoint (proxied through gateway as /api/ai/agent/chat)
 * 
 * Supports file export: when the agent generates files, they are returned as
 * { id, filename, downloadUrl } in the response and stored in exportedFiles state.
 */
import { useState, useCallback, useRef } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  files?: ExportedFile[];
}

export interface ExportedFile {
  id: string;
  filename: string;
  downloadUrl: string;
}

export interface AgentRequestContext {
  [key: string]: unknown;
}

export interface AgentEmailAction {
  type: string;
  draftId?: string;
  mailboxId?: string;
  folder?: string;
  subject?: string;
  to?: string;
}

interface AgentChatResponse {
  reply: string;
  agent: string;
  module: string;
  model: string;
  files?: ExportedFile[];
  emailAction?: AgentEmailAction;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
}

interface QuotaInfo {
  used_tokens: number;
  max_tokens: number;
  remaining: number;
  unlimited: boolean;
  percentage_used: number;
}

interface UseAgentChatOptions {
  moduleKey?: string;
  onError?: (error: string) => void;
  getRequestContext?: () => AgentRequestContext | undefined;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { moduleKey = "platform", onError, getRequestContext } = options;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch quota info
  const fetchQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/quota", { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setQuota(json.data);
        }
      }
    } catch {
      // Non-blocking
    }
  }, []);

  // Send a message to the agent
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setError(null);
      const userMessage: ChatMessage = {
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        abortRef.current = new AbortController();
        const res = await fetch("/api/ai/agent/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content.trim(),
            moduleKey,
            ...(getRequestContext?.() || {}),
          }),
          signal: abortRef.current.signal,
        });

        if (res.status === 429) {
          const json = await res.json();
          const errMsg = json?.error?.message || "Quota de tokens excedida.";
          setError(errMsg);
          onError?.(errMsg);
          // Add system message about quota
          setMessages((prev) => [
            ...prev,
            {
              role: "system" as const,
              content: `⚠️ ${errMsg}`,
              timestamp: Date.now(),
            },
          ]);
          setIsLoading(false);
          return;
        }

        if (!res.ok) {
          const json = await res.json().catch(() => null);
          const errMsg = json?.error?.message || "Erro ao comunicar com o assistente.";
          setError(errMsg);
          onError?.(errMsg);
          setMessages((prev) => [
            ...prev,
            {
              role: "system" as const,
              content: `❌ ${errMsg}`,
              timestamp: Date.now(),
            },
          ]);
          setIsLoading(false);
          return;
        }

        const json = await res.json();
        if (json.success && json.data) {
          const data: AgentChatResponse = json.data;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.reply,
              timestamp: Date.now(),
              files: data.files,
            },
          ]);
          if (data.emailAction && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("viao-agent-email-action", { detail: data.emailAction }));
          }
          // Update quota after each message
          fetchQuota();
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        const errMsg = "Erro de rede. Verifique a sua ligação.";
        setError(errMsg);
        onError?.(errMsg);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [moduleKey, isLoading, onError, fetchQuota, getRequestContext]
  );

  // Clear conversation
  const clearHistory = useCallback(async () => {
    setMessages([]);
    setError(null);
    try {
      await fetch(`/api/ai/agent/sessions/${moduleKey}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      // Non-blocking
    }
  }, [moduleKey]);

  // Cancel current request
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  return {
    messages,
    isLoading,
    error,
    quota,
    sendMessage,
    clearHistory,
    cancel,
    fetchQuota,
  };
}
