import { describe, expect, it, vi } from 'vitest';
import {
  buildEmailAssistantContextRelay,
  shouldRelayEmailAssistantContextMessage,
} from './moduleAssistantContextBridge';

describe('Email assistant iframe context bridge', () => {
  it('relays selected email context from the iframe window into the parent assistant context event', () => {
    const iframeWindow = { name: 'email-iframe' } as unknown as Window;
    const detail = {
      selectedEmailId: 'email-1',
      selectedEmailIds: ['email-1'],
      selectedMailboxId: 'mailbox-1',
      selectedFolder: 'INBOX',
      selectedEmail: { id: 'email-1', subject: 'Pedido', from: 'Cliente' },
    };
    const event = {
      source: iframeWindow,
      data: { type: 'viao-email-assistant-context', detail },
    } as MessageEvent;

    expect(shouldRelayEmailAssistantContextMessage(event, 'email', iframeWindow)).toBe(true);

    const dispatchEvent = vi.fn();
    const targetWindow = { dispatchEvent } as unknown as Window;
    const relay = buildEmailAssistantContextRelay({ slug: 'email', iframeWindow, targetWindow });

    expect(relay(event)).toBe(true);
    expect((targetWindow as any).__viaEmailAssistantContext).toEqual(detail);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const dispatched = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(dispatched.type).toBe('viao-email-assistant-context');
    expect(dispatched.detail).toEqual(detail);
  });

  it('ignores context messages from other modules or non-iframe sources', () => {
    const iframeWindow = { name: 'email-iframe' } as unknown as Window;
    const otherWindow = { name: 'other' } as unknown as Window;
    const event = {
      source: otherWindow,
      data: { type: 'viao-email-assistant-context', detail: { selectedEmailId: 'email-1' } },
    } as MessageEvent;

    expect(shouldRelayEmailAssistantContextMessage(event, 'email', iframeWindow)).toBe(false);
    expect(shouldRelayEmailAssistantContextMessage(event, 'helpdesk', iframeWindow)).toBe(false);
  });
});
