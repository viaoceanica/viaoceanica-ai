import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAssistantDraftInstruction,
  buildDraftSavePayload,
  buildDraftPreviewReply,
  buildDraftSavedEmailAction,
  buildDraftSaveSystemPrompt,
  requiresSelectedEmailContext,
  hasUsableSelectedEmailContext,
  buildSelectedEmailSummaryReply,
} from './src/emailDraftActions.ts';

test('detects explicit save-draft reply request', () => {
  const result = parseAssistantDraftInstruction('Cria e guarda um rascunho de resposta curto para este email');
  assert.equal(result.requested, true);
  assert.equal(result.shouldSaveDraft, true);
  assert.equal(result.kind, 'reply');
});

test('does not save ordinary draft text unless user asks to save it', () => {
  const result = parseAssistantDraftInstruction('Rascunha uma resposta curta para este email');
  assert.equal(result.requested, true);
  assert.equal(result.shouldSaveDraft, false);
});

test('builds safe reply draft payload from selected email context', () => {
  const payload = buildDraftSavePayload({
    mailboxId: 'mailbox-1',
    selectedEmail: {
      subject: 'Pedido de orçamento',
      fromAddress: 'cliente@example.com',
    },
    draftText: 'Assunto: Re: Pedido de orçamento\n\nOlá,\n\nSegue a resposta proposta.\n\nCumprimentos,',
  });

  assert.equal(payload.mailboxId, 'mailbox-1');
  assert.equal(payload.to, 'cliente@example.com');
  assert.equal(payload.subject, 'Re: Pedido de orçamento');
  assert.match(payload.body_text, /Segue a resposta proposta/);
  assert.match(payload.body_html, /Segue a resposta proposta/);
});

test('ignores assistant preface before an Assunto line when saving', () => {
  const payload = buildDraftSavePayload({
    mailboxId: 'mailbox-1',
    selectedEmail: {
      subject: 'Pedido de orçamento',
      fromAddress: 'cliente@example.com',
    },
    draftText: 'Claro, aqui está o rascunho:\n\nAssunto: Resposta a seu Email\n\nPrezado cliente,\n\nObrigado pelo contacto.',
  });

  assert.equal(payload.subject, 'Resposta a seu Email');
  assert.doesNotMatch(payload.body_text, /Claro, aqui está/);
  assert.match(payload.body_text, /Prezado cliente/);
});


test('sanitizes draft preview and payload before asking for save confirmation', () => {
  const payload = buildDraftSavePayload({
    mailboxId: 'mailbox-1',
    selectedEmail: {
      subject: 'radio atlantida',
      fromAddress: 'gerencia@viaoceanica.com',
    },
    draftText: 'Claro, aqui está o rascunho guardado:\n\nAssunto: Confirmação do recebimento - Radio Atlântida\n\nPrezado(a),\n\nConfirmando o recebimento de sua mensagem. Estamos analisando as informações fornecidas.\n\nAtenciosamente,\n[Seu Nome]\n[Via Oceânica]',
  });
  const preview = buildDraftPreviewReply(payload);

  assert.doesNotMatch(payload.body_text, /Claro, aqui está/i);
  assert.doesNotMatch(payload.body_text, /\[Seu Nome\]|\[Via Oceânica\]/i);
  assert.doesNotMatch(preview, /Claro, aqui está/i);
  assert.doesNotMatch(preview, /\[Seu Nome\]|\[Via Oceânica\]/i);
  assert.match(preview, /Assunto: Confirmação do recebimento - Radio Atlântida/);
  assert.match(preview, /Confirmando o recebimento/);
  assert.match(preview, /Responde "confirmar"/);
});

test('builds draft-saved action metadata for UI refresh/open', () => {
  const action = buildDraftSavedEmailAction({ id: 'draft-123', folder: 'INBOX.Drafts' }, {
    mailboxId: 'mailbox-1',
    to: 'cliente@example.com',
    cc: '',
    bcc: '',
    subject: 'Re: Pedido',
    body_text: 'Olá',
    body_html: '<p>Olá</p>',
  });

  assert.deepEqual(action, {
    type: 'draft_saved',
    draftId: 'draft-123',
    mailboxId: 'mailbox-1',
    folder: 'INBOX.Drafts',
    subject: 'Re: Pedido',
    to: 'cliente@example.com',
  });
});

test('draft prompt forces direct answer based on selected email context', () => {
  const prompt = buildDraftSaveSystemPrompt({
    subject: 'Pedido de orçamento',
    from: 'Cliente Teste <cliente@example.com>',
    bodyPreview: 'Pode enviar orçamento para 10 licenças?',
  });

  assert.match(prompt, /Pedido de orçamento/);
  assert.match(prompt, /Pode enviar orçamento para 10 licenças/);
  assert.match(prompt, /sem introduções/i);
  assert.match(prompt, /Assunto:/);
});


test('detects deictic selected-email requests that require UI email context', () => {
  assert.equal(requiresSelectedEmailContext('Resume este email em 3 pontos'), true);
  assert.equal(requiresSelectedEmailContext('Arquiva este email'), true);
  assert.equal(requiresSelectedEmailContext('Cria e guarda um rascunho de resposta curto para este email'), true);
  assert.equal(requiresSelectedEmailContext('Quantos emails tenho na inbox?'), false);
});

test('validates selected email context for deictic draft requests', () => {
  assert.equal(hasUsableSelectedEmailContext(null), false);
  assert.equal(hasUsableSelectedEmailContext({ selectedEmailId: '', selectedEmailIds: [], selectedEmail: null }), false);
  assert.equal(hasUsableSelectedEmailContext({ selectedEmailId: 'email-1', selectedMailboxId: 'mailbox-1', selectedEmail: { id: 'email-1' } }), true);
  assert.equal(hasUsableSelectedEmailContext({ selectedEmailIds: ['email-1'], selectedMailboxId: 'mailbox-1' }), true);
});


test('builds selected-email summary reply from UI context only', () => {
  const reply = buildSelectedEmailSummaryReply({
    selectedEmailId: 'email-1',
    selectedEmail: {
      subject: 'Pedido de orçamento',
      from: 'Cliente <cliente@example.com>',
      folder: 'INBOX',
      receivedAt: '2026-05-24',
      bodyPreview: 'Pode enviar orçamento para 10 licenças até amanhã?',
    },
  });

  assert.match(reply, /Resumo do email selecionado/);
  assert.match(reply, /Pedido de orçamento/);
  assert.match(reply, /10 licenças/);
  assert.doesNotMatch(reply, /últimos emails/i);
});
