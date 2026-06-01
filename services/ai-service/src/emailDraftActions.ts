export type EmailDraftInstruction = {
  requested: boolean;
  shouldSaveDraft: boolean;
  kind: 'reply' | 'new';
};

export type DraftSavePayload = {
  mailboxId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body_text: string;
  body_html: string;
};

export type DraftSavedEmailAction = {
  type: 'draft_saved';
  draftId: string;
  mailboxId: string;
  folder: string;
  subject: string;
  to: string;
};

export type SelectedEmailPromptContext = {
  subject?: string;
  from?: string;
  fromAddress?: string;
  toAddresses?: string;
  receivedAt?: string;
  folder?: string;
  snippet?: string;
  bodyPreview?: string;
  hasAttachments?: boolean;
};

export type DraftSaveInput = {
  mailboxId?: string | null;
  selectedEmail?: {
    subject?: string;
    fromAddress?: string;
    from?: string;
  } | null;
  draftText: string;
  explicitTo?: string;
  explicitSubject?: string;
};

export type SelectedEmailContextLike = {
  selectedEmailId?: string | null;
  selectedEmailIds?: Array<string | null | undefined> | null;
  selectedMailboxId?: string | null;
  selectedEmail?: { id?: string | null } | null;
} | null | undefined;

export function hasUsableSelectedEmailContext(context: SelectedEmailContextLike): boolean {
  if (!context) return false;
  const selectedEmailId = String(context.selectedEmailId || context.selectedEmail?.id || '').trim();
  if (selectedEmailId) return true;
  return Array.isArray(context.selectedEmailIds)
    && context.selectedEmailIds.some((id) => String(id || '').trim().length > 0);
}

export function requiresSelectedEmailContext(message: string): boolean {
  const normalized = normalizeText(message || '');
  if (!normalized) return false;

  const mentionsEmail = /\b(?:email|emails|mail|mails|mensagem|mensagens|isto|isso)\b/.test(normalized);
  const deicticReference = /\b(?:este|esta|estes|estas|esse|essa|esses|essas|isto|isso|aberto|aberta|selecionado|selecionada|selecionados|selecionadas|selected|open|this|these)\b/.test(normalized);
  const selectedIntent = /\b(?:resume|resumir|sumariza|summari[sz]e|rascunh\w*|responde\w*|reply|arquiv\w*|apaga\w*|delete|marca\w*|move|mover|sinaliza\w*|importante|lido|unread|read|encaminh\w*|forward)\b/.test(normalized);
  const broadInventoryQuestion = /\b(?:quantos|quantas|count|how many|numero|lista|listar|todos|todas|inbox|caixa de entrada|recebidos)\b/.test(normalized);

  return mentionsEmail && deicticReference && selectedIntent && !broadInventoryQuestion;
}

export function buildSelectedEmailSummaryReply(context: SelectedEmailContextLike & { selectedEmail?: {
  subject?: string | null;
  from?: string | null;
  fromAddress?: string | null;
  snippet?: string | null;
  bodyPreview?: string | null;
  folder?: string | null;
  receivedAt?: string | null;
} | null }): string {
  const email = context?.selectedEmail || null;
  const count = Array.isArray(context?.selectedEmailIds)
    ? context.selectedEmailIds.filter((id) => String(id || '').trim()).length
    : 0;
  if (!email && count > 1) {
    return `Tens ${count} emails selecionados. Abre um deles ou pede "resume os emails selecionados" para resumir o conjunto.`;
  }

  const subject = String(email?.subject || '(Sem assunto)').trim();
  const from = String(email?.from || email?.fromAddress || 'Remetente desconhecido').trim();
  const folder = String(email?.folder || '').trim();
  const receivedAt = String(email?.receivedAt || '').trim();
  const body = String(email?.bodyPreview || email?.snippet || '').replace(/\s+/g, ' ').trim();
  const summary = body
    ? body.slice(0, 900)
    : 'O contexto recebido identifica o email selecionado, mas ainda não inclui o corpo/resumo carregado.';

  return [
    `Resumo do email selecionado: ${subject}`,
    `De: ${from}`,
    receivedAt ? `Data: ${receivedAt}` : null,
    folder ? `Pasta: ${folder}` : null,
    '',
    summary,
  ].filter((line): line is string => line !== null).join('\n');
}

export function buildSelectedEmailContextRequiredReply(): string {
  return [
    'Não tenho nenhum email aberto ou selecionado como contexto neste momento.',
    'Abre ou seleciona o email no módulo Email e volta a pedir, por exemplo: "resume este email" ou "rascunha uma resposta a este email".',
  ].join('\n');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAssistantDraftInstruction(message: string): EmailDraftInstruction {
  const normalized = normalizeText(message || '');
  const requested = /\b(?:rascunh\w*|draft(?:ing)?|responde\s+a|reply\s+to|resposta\s+a|reply|responder\s+a|cria(?:r)?\s+(?:um\s+)?email|create\s+(?:an?\s+)?email)\b/.test(normalized)
    && /(email|mail|mensagem|isto|este|esta|resposta|reply|rascunho|draft)/.test(normalized);
  const shouldSaveDraft = /\b(?:guardar|guarda|salvar|salva|save|criar|cria|create|gravar|grava)\b/.test(normalized)
    && /\b(?:rascunho|draft)\b/.test(normalized);
  const kind = /\b(?:novo\s+email|new\s+email|cria(?:r)?\s+(?:um\s+)?email|create\s+(?:an?\s+)?email)\b/.test(normalized)
    && !/\b(?:resposta|reply|responder)\b/.test(normalized)
    ? 'new'
    : 'reply';

  return { requested, shouldSaveDraft, kind };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value: string): string {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function stripSubjectPrefix(value: string): string {
  return value.replace(/^\s*(?:assunto|subject|asunto)\s*:\s*/i, '').trim();
}

function sanitizeDraftBody(body: string): string {
  const withoutGenericPlaceholderLines = String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*\[[^\]\n]{1,80}\]\s*$/.test(line))
    .join('\n');

  return withoutGenericPlaceholderLines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitDraftSubjectAndBody(draftText: string, fallbackSubject: string): { subject: string; body: string } {
  const text = String(draftText || '').replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');
  const subjectLineIndex = lines.findIndex((line, index) => (
    index <= 5 && /^\s*(?:assunto|subject|asunto)\s*:/i.test(line)
  ));
  if (subjectLineIndex >= 0) {
    const subject = stripSubjectPrefix(lines[subjectLineIndex] || '') || fallbackSubject;
    const body = sanitizeDraftBody(lines.slice(subjectLineIndex + 1).join('\n').trim() || text);
    return { subject, body };
  }
  return { subject: fallbackSubject, body: sanitizeDraftBody(text) };
}

function buildReplySubject(subject?: string): string {
  const clean = (subject || '').trim() || '(Sem assunto)';
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

function extractEmailAddress(value?: string): string {
  const text = (value || '').trim();
  const angleMatch = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch) return angleMatch[1].trim();
  const plainMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch ? plainMatch[0].trim() : '';
}

export function buildDraftSavePayload(input: DraftSaveInput): DraftSavePayload {
  const mailboxId = (input.mailboxId || '').trim();
  if (!mailboxId) throw new Error('É preciso selecionar uma mailbox antes de guardar o rascunho.');

  const fallbackSubject = input.explicitSubject?.trim()
    || buildReplySubject(input.selectedEmail?.subject);
  const { subject, body } = splitDraftSubjectAndBody(input.draftText, fallbackSubject);
  const to = input.explicitTo?.trim()
    || extractEmailAddress(input.selectedEmail?.fromAddress)
    || extractEmailAddress(input.selectedEmail?.from)
    || '';

  if (!to) throw new Error('Não consegui identificar o destinatário do rascunho.');
  if (!body.trim()) throw new Error('O rascunho gerado está vazio.');

  return {
    mailboxId,
    to,
    cc: '',
    bcc: '',
    subject: subject.slice(0, 512),
    body_text: body,
    body_html: textToHtml(body),
  };
}

export function buildDraftSaveConfirmation(payload: DraftSavePayload): string {
  return [
    'Preparei um rascunho para guardar na mailbox.',
    `Para: ${payload.to}`,
    `Assunto: ${payload.subject}`,
    '',
    'Responde "confirmar" para guardar o rascunho ou "cancelar" para abortar.',
  ].join('\n');
}

export function buildDraftPreviewReply(payload: DraftSavePayload): string {
  return [
    `Assunto: ${payload.subject}`,
    '',
    payload.body_text.trim(),
    '',
    buildDraftSaveConfirmation(payload),
  ].filter((part) => String(part || '').trim().length > 0).join('\n');
}

export function buildDraftSavedEmailAction(result: any, payload: DraftSavePayload): DraftSavedEmailAction {
  return {
    type: 'draft_saved',
    draftId: String(result?.id || ''),
    mailboxId: payload.mailboxId,
    folder: String(result?.folder || 'INBOX.Drafts'),
    subject: payload.subject,
    to: payload.to,
  };
}

export function buildDraftSaveSystemPrompt(selectedEmail?: SelectedEmailPromptContext | null): string {
  const lines = [
    'INSTRUÇÕES_RASCUNHO_EMAIL:',
    '- Escreve apenas o rascunho final pronto a enviar, sem introduções, sem comentários e sem placeholders genéricos se houver contexto suficiente.',
    '- Usa português profissional de Portugal por defeito.',
    '- Começa com uma linha "Assunto: ..." seguida de uma linha em branco e depois o corpo do email.',
    '- Baseia a resposta estritamente no email selecionado e no pedido do utilizador.',
  ];

  if (selectedEmail) {
    lines.push('EMAIL_SELECIONADO_FORNECIDO_PELO_UI:');
    lines.push(`- de=${selectedEmail.from || selectedEmail.fromAddress || 'Remetente desconhecido'}`);
    lines.push(`- para=${selectedEmail.toAddresses || '—'}`);
    lines.push(`- assunto=${selectedEmail.subject || '(Sem assunto)'}`);
    lines.push(`- pasta=${selectedEmail.folder || 'INBOX'}`);
    lines.push(`- data=${selectedEmail.receivedAt || 'sem_data'}`);
    lines.push(`- anexos=${selectedEmail.hasAttachments ? 'sim' : 'nao'}`);
    if (selectedEmail.snippet) lines.push(`- resumo=${selectedEmail.snippet}`);
    if (selectedEmail.bodyPreview) lines.push(`- corpo=${selectedEmail.bodyPreview}`);
  }

  return lines.join('\n');
}
