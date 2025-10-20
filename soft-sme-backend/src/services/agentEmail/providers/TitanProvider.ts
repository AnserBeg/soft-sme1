import { ImapFlow, type ImapFlowOptions, type SearchObject } from 'imapflow';
import nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';
import { simpleParser } from 'mailparser';
import { AgentEmailDraftStore } from '../draftStore';
import type {
  ComposeEmailPayload,
  EmailAttachmentMetadata,
  EmailDraftPreview,
  EmailMessageDetail,
  EmailParticipant,
  EmailProvider,
  EmailSummary,
  EmailSendInput,
  ReplyInput,
  SendResult,
  TitanConnectionConfig,
} from '../types';

const MAILBOX = 'INBOX';

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align'],
  },
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https', 'data'],
  },
  transformTags: {
    'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

const formatAddress = (participant?: { address?: string; name?: string | null }): EmailParticipant | null => {
  if (!participant || !participant.address) {
    return null;
  }
  return {
    address: participant.address,
    name: participant.name ?? undefined,
  };
};

const sanitizeAddressList = (list?: Array<{ address?: string; name?: string | null }>): EmailParticipant[] => {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((entry) => formatAddress(entry))
    .filter((participant): participant is EmailParticipant => Boolean(participant?.address));
};

const normalizeAddresses = (value?: string | string[]): string[] => {
  if (!value) {
    return [];
  }
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
};

const toSearchList = (current: string | string[] | undefined): string[] => {
  if (!current) {
    return [];
  }

  const source = Array.isArray(current) ? current : current.split(',');

  return source
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const appendSearchValue = (current: string | string[] | undefined, value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return Array.isArray(current) ? current.join(', ') : current ?? '';
  }

  const entries = toSearchList(current);
  if (!entries.includes(normalized)) {
    entries.push(normalized);
  }

  return entries.join(', ');
};

const parseDateToken = (value: string): Date | undefined => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
};

type MutableSearchObject = SearchObject & {
  text?: string;
  header?: Array<[string, string]>;
};

export const parseQuery = (query: string): { search: SearchObject } => {
  const search: MutableSearchObject = {};
  const textTerms: string[] = [];
  const headerMap: Record<string, string | boolean> = {};

  const tokens = Array.from(query.matchAll(/(\w+:"[^"]+"|\w+:[^\s]+|"[^"]+"|\S+)/g)).map((match) => match[0]);

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    const [key, ...rest] = token.split(':');
    if (rest.length === 0) {
      textTerms.push(token.replace(/"/g, ''));
      continue;
    }

    const valueRaw = rest.join(':').replace(/^"|"$/g, '');
    const value = valueRaw.trim();
    if (!value) {
      continue;
    }

    switch (key.toLowerCase()) {
      case 'from':
        search.from = appendSearchValue(search.from, value);
        break;
      case 'to':
        search.to = appendSearchValue(search.to, value);
        break;
      case 'cc':
        search.cc = appendSearchValue(search.cc, value);
        break;
      case 'bcc':
        search.bcc = appendSearchValue(search.bcc, value);
        break;
      case 'subject':
        search.subject = appendSearchValue(search.subject, value);
        break;
      case 'after':
      case 'since': {
        const date = parseDateToken(value);
        if (date) {
          search.since = date;
        }
        break;
      }
      case 'before': {
        const date = parseDateToken(value);
        if (date) {
          search.before = date;
        }
        break;
      }
      case 'has':
        if (value.toLowerCase() === 'attachment') {
          const marker: [string, string] = ['Content-Type', 'multipart'];
          if (!headerPairs.some(([key, headerValue]) => key === marker[0] && headerValue === marker[1])) {
            headerPairs.push(marker);
          }
        }
        break;
      case 'unread':
        if (value.toLowerCase() === 'true') {
          search.seen = false;
        }
        break;
      default:
        textTerms.push(token.replace(/"/g, ''));
        break;
    }
  }

  const textQuery = textTerms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (textQuery.length > 0) {
    search.text = textQuery.join(' ');
  }

  if (Object.keys(headerMap).length > 0) {
    search.header = headerMap;
  }

  return { search };
};

const normalizeDateString = (date: Date | string | number | undefined): string => {
  if (!date) {
    return new Date().toISOString();
  }
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) {
    return new Date().toISOString();
  }
  return dt.toISOString();
};

const toAttachmentMeta = (attachment: any, index: number): EmailAttachmentMetadata => ({
  id: attachment.contentId || `${index}`,
  filename: attachment.filename || `attachment-${index + 1}`,
  contentType: attachment.contentType || 'application/octet-stream',
  size: typeof attachment.size === 'number' ? attachment.size : 0,
  inline: Boolean(attachment.contentDisposition === 'inline'),
  cid: attachment.cid || attachment.contentId || null,
});

const buildMailOptions = (config: TitanConnectionConfig, payload: ComposeEmailPayload) => {
  return {
    from: config.email,
    to: normalizeAddresses(payload.to).join(', '),
    cc: normalizeAddresses(payload.cc).join(', ') || undefined,
    bcc: normalizeAddresses(payload.bcc).join(', ') || undefined,
    subject: payload.subject,
    text: payload.textBody,
    html: payload.htmlBody,
    attachments: payload.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      encoding: attachment.encoding,
      contentType: attachment.contentType,
      cid: attachment.cid,
      disposition: attachment.inline ? 'inline' : undefined,
    })),
    inReplyTo: payload.inReplyTo,
    references: payload.references,
  };
};

export class TitanProvider implements EmailProvider {
  readonly providerName = 'titan';

  constructor(
    private readonly userId: number,
    private readonly config: TitanConnectionConfig,
    private readonly draftStore: AgentEmailDraftStore
  ) {}

  private buildImapOptions(readonly = true): ImapFlowOptions {
    return {
      host: this.config.hostImap,
      port: this.config.portImap,
      secure: true,
      auth: {
        user: this.config.email,
        pass: this.config.password,
      },
      tls: {
        rejectUnauthorized: true,
      },
      logger: false,
    };
  }

  private async withMailbox<T>(fn: (client: ImapFlow) => Promise<T>, readOnly = true): Promise<T> {
    const client = new ImapFlow(this.buildImapOptions(readOnly));
    await client.connect();
    try {
      await client.mailboxOpen(MAILBOX, { readOnly });
      const result = await fn(client);
      await client.logout();
      return result;
    } catch (error) {
      try {
        await client.close();
      } catch (closeError) {
        // ignore
      }
      throw error;
    }
  }

  async emailSearch(query: string, max?: number): Promise<EmailSummary[]> {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const { search } = parseQuery(normalizedQuery);
    const searchQuery: SearchObject = normalizedQuery.length > 0 ? search : {};

    return this.withMailbox(async (client) => {
      const uids = await client.search(searchQuery, { uid: true });
      const sorted = Array.isArray(uids) ? [...uids].sort((a, b) => b - a) : [];
      const limited = typeof max === 'number' && max > 0 ? sorted.slice(0, max) : sorted;

      const summaries: EmailSummary[] = [];
      for (const uid of limited) {
        const message = await client.fetchOne(uid, { source: true, envelope: true, flags: true, internalDate: true });
        if (!message) {
          continue;
        }
        const parsed = await simpleParser(message.source!);
        const subject = parsed.subject || message.envelope?.subject || '(no subject)';
        const from = sanitizeAddressList(message.envelope?.from || parsed.from?.value || [])
          .map((entry) => entry.address)
          .join(', ');
        const to = sanitizeAddressList(message.envelope?.to || parsed.to?.value || [])
          .map((entry) => entry.address);
        const snippetSource = parsed.text || parsed.html || '';
        const snippet = snippetSource.replace(/\s+/g, ' ').trim().slice(0, 160);
        const hasAttachments = Array.isArray(parsed.attachments) && parsed.attachments.length > 0;

        summaries.push({
          id: String(uid),
          subject,
          from,
          to,
          date: normalizeDateString(message.internalDate),
          snippet,
          flags: Array.isArray(message.flags) ? [...message.flags] : [],
          hasAttachments,
          threadId: parsed.headers.get('thread-index') || null,
          messageId: parsed.messageId || null,
        });
      }

      return summaries;
    });
  }

  async emailRead(id: string): Promise<EmailMessageDetail> {
    const uid = Number(id);
    if (!Number.isFinite(uid)) {
      throw new Error('Titan email identifier must be a numeric UID');
    }

    return this.fetchByUid(uid);
  }

  private async fetchByUid(uid: number): Promise<EmailMessageDetail> {
    return this.withMailbox(async (client) => {
      const message = await client.fetchOne(uid, { source: true, envelope: true, flags: true, internalDate: true });
      if (!message || !message.source) {
        throw new Error('Email not found in Titan mailbox');
      }

      const parsed = await simpleParser(message.source);
      const attachments = (parsed.attachments || []).map((attachment, index) => toAttachmentMeta(attachment, index));
      const htmlBody = parsed.html ? sanitizeHtml(parsed.html, sanitizeOptions) : undefined;

      return {
        id: String(uid),
        messageId: parsed.messageId || message.envelope?.messageId || String(uid),
        threadId: parsed.headers.get('thread-index') || null,
        subject: parsed.subject || message.envelope?.subject || '(no subject)',
        from: formatAddress(parsed.from?.value?.[0]) || formatAddress(message.envelope?.from?.[0]) || {
          address: this.config.email,
        },
        to: sanitizeAddressList(parsed.to?.value || message.envelope?.to || []),
        cc: sanitizeAddressList(parsed.cc?.value || message.envelope?.cc || []),
        bcc: sanitizeAddressList(parsed.bcc?.value || []),
        date: normalizeDateString(message.internalDate),
        textBody: parsed.text || undefined,
        htmlBody,
        attachments,
        headers: Object.fromEntries(Array.from(parsed.headers.entries()).map(([key, value]) => [key, String(value)])),
      };
    });
  }

  private async fetchByMessageId(messageId: string): Promise<EmailMessageDetail> {
    return this.withMailbox(async (client) => {
      const matches = await client.search({ header: [['Message-ID', messageId]] }, { uid: true });
      const uidList = Array.isArray(matches) ? matches : [];
      if (uidList.length === 0) {
        throw new Error('Original message not found in Titan mailbox for reply.');
      }
      const uid = uidList[uidList.length - 1];
      return this.fetchByUid(uid);
    });
  }

  async emailComposeDraft(payload: ComposeEmailPayload): Promise<{ draftId: string; preview: EmailDraftPreview }> {
    const normalizedPayload: ComposeEmailPayload = {
      ...payload,
      to: normalizeAddresses(payload.to),
      cc: normalizeAddresses(payload.cc),
      bcc: normalizeAddresses(payload.bcc),
    };

    const { draftId, preview, confirmToken } = await this.draftStore.createDraft(
      this.userId,
      'titan',
      normalizedPayload
    );

    return {
      draftId,
      preview: { ...preview, confirmToken },
    };
  }

  private async sendPayload(payload: ComposeEmailPayload): Promise<SendResult> {
    const transporter = nodemailer.createTransport({
      host: this.config.hostSmtp,
      port: this.config.portSmtp,
      secure: true,
      auth: {
        user: this.config.email,
        pass: this.config.password,
      },
      tls: {
        rejectUnauthorized: true,
      },
    });

    const info = await transporter.sendMail(buildMailOptions(this.config, payload));
    return {
      status: 'sent',
      messageId: info.messageId,
      threadId: payload.threadId || payload.inReplyTo || null,
    };
  }

  async emailSend(input: EmailSendInput): Promise<SendResult> {
    const token = typeof input.confirmToken === 'string' ? input.confirmToken.trim() : '';
    if (!token) {
      throw new Error('A confirmation token is required before sending email.');
    }

    if (input.draftId) {
      const { payload } = await this.draftStore.verifyAndConsumeDraft(this.userId, 'titan', input.draftId, token);
      return this.sendPayload(payload);
    }

    if (!input.payload) {
      throw new Error('Either a draftId or payload must be provided for email_send. Compose a draft first.');
    }

    throw new Error('Direct payload send is not supported for Titan without a stored draft.');
  }

  async emailReply(target: ReplyInput): Promise<SendResult> {
    const identifier = target.messageId || target.threadId;
    if (!identifier) {
      throw new Error('A messageId or threadId is required to send a reply.');
    }

    const replyAll = Boolean(target.replyAll);

    const message = identifier.match(/^\d+$/)
      ? await this.fetchByUid(Number(identifier))
      : await this.fetchByMessageId(identifier);

    const replyToHeader = message.headers['reply-to'];
    const replyCandidates = normalizeAddresses(
      replyToHeader ? replyToHeader.split(',') : [message.from.address]
    );
    const primaryReplyTo = replyCandidates[0] || message.from.address;

    const recipientsMap = new Map<string, string>();
    const addRecipient = (address: string | undefined) => {
      if (!address) {
        return;
      }
      const trimmed = address.trim();
      if (!trimmed) {
        return;
      }
      const lower = trimmed.toLowerCase();
      if (!recipientsMap.has(lower)) {
        recipientsMap.set(lower, trimmed);
      }
    };

    addRecipient(primaryReplyTo);
    message.to.forEach((participant) => addRecipient(participant.address));
    (message.cc || []).forEach((participant) => addRecipient(participant.address));
    recipientsMap.delete(this.config.email.toLowerCase());

    const primaryLower = primaryReplyTo.toLowerCase();
    const to = replyAll
      ? Array.from(recipientsMap.values())
      : [recipientsMap.get(primaryLower) || primaryReplyTo];
    const payload: ComposeEmailPayload = {
      to,
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      textBody: target.bodyText,
      htmlBody: target.bodyHtml ? sanitizeHtml(target.bodyHtml, sanitizeOptions) : undefined,
      attachments: target.attachments,
      inReplyTo: message.messageId,
      references: [message.messageId],
      threadId: message.threadId,
    };

    return this.sendPayload(payload);
  }
}

export const TitanProviderInternals = {
  parseQuery,
};
