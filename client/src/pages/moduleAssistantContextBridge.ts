export const EMAIL_ASSISTANT_CONTEXT_EVENT = "viao-email-assistant-context";

export type EmailAssistantUiContext = {
  selectedEmailId?: string;
  selectedEmailIds?: string[];
  selectedMailboxId?: string;
  selectedFolder?: string;
  selectedEmail?: Record<string, unknown> | null;
} | null;

type RelayOptions = {
  slug: string;
  iframeWindow?: Window | null;
  targetWindow?: Window;
};

export function shouldRelayEmailAssistantContextMessage(
  event: MessageEvent,
  slug: string,
  iframeWindow?: Window | null,
): boolean {
  if (slug !== "email") return false;
  if (!event?.data || event.data.type !== EMAIL_ASSISTANT_CONTEXT_EVENT) return false;
  if (iframeWindow && event.source !== iframeWindow) return false;
  return true;
}

export function buildEmailAssistantContextRelay({ slug, iframeWindow, targetWindow = window }: RelayOptions) {
  return (event: MessageEvent): boolean => {
    if (!shouldRelayEmailAssistantContextMessage(event, slug, iframeWindow)) return false;
    const detail = (event.data?.detail || null) as EmailAssistantUiContext;
    (targetWindow as Window & { __viaEmailAssistantContext?: EmailAssistantUiContext }).__viaEmailAssistantContext = detail;
    targetWindow.dispatchEvent(new CustomEvent(EMAIL_ASSISTANT_CONTEXT_EVENT, { detail }));
    return true;
  };
}
