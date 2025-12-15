export interface TitanConnectionConfig {
  hostImap: string;
  portImap: number;
  hostSmtp: string;
  portSmtp: number;
  email: string;
  password: string;
}

export interface EmailAttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline?: boolean;
  cid?: string | null;
}

export interface EmailAttachmentContent {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
}

export interface EmailSummary {
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet?: string;
  flags?: string[];
  hasAttachments: boolean;
  threadId?: string | null;
  messageId?: string | null;
}

export interface EmailParticipant {
  name?: string | null;
  address: string;
}

export interface EmailMessageDetail {
  id: string;
  messageId: string;
  threadId?: string | null;
  subject: string;
  from: EmailParticipant;
  to: EmailParticipant[];
  cc?: EmailParticipant[];
  bcc?: EmailParticipant[];
  date: string;
  textBody?: string;
  htmlBody?: string;
  attachments: EmailAttachmentMetadata[];
  headers: Record<string, string>;
}

export interface ComposeEmailAttachmentPayload {
  filename: string;
  content: string;
  encoding?: BufferEncoding | 'base64url';
  contentType?: string;
  cid?: string;
  inline?: boolean;
}

export interface ComposeEmailPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  attachments?: ComposeEmailAttachmentPayload[];
  inReplyTo?: string;
  references?: string[];
  threadId?: string | null;
  messageId?: string | null;
}

export interface EmailDraftPreview {
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  snippet: string;
  attachments?: EmailAttachmentMetadata[];
  confirmToken: string;
}

export interface DraftRecord {
  id: string;
  provider: string;
  userId: number;
  payload: ComposeEmailPayload;
  preview: EmailDraftPreview;
  confirmToken: string;
  expiresAt: Date;
}

export interface EmailSendInput {
  draftId?: string;
  payload?: ComposeEmailPayload;
  confirmToken: string;
}

export interface ReplyInput {
  messageId?: string;
  threadId?: string;
  replyAll?: boolean;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: ComposeEmailAttachmentPayload[];
}

export interface SendResult {
  status: 'sent';
  messageId: string;
  threadId?: string | null;
}

export interface EmailProvider {
  readonly providerName: string;
  emailSearch(query: string, max?: number): Promise<EmailSummary[]>;
  emailRead(id: string): Promise<EmailMessageDetail>;
  emailGetAttachment(messageId: string, attachmentId: string): Promise<EmailAttachmentContent>;
  emailComposeDraft(payload: ComposeEmailPayload): Promise<{ draftId: string; preview: EmailDraftPreview }>;
  emailSend(input: EmailSendInput): Promise<SendResult>;
  emailReply(target: ReplyInput): Promise<SendResult>;
}

export interface EmailPolicyConfig {
  emailEnabled: boolean;
  emailSendEnabled: boolean;
  allowExternal: boolean;
  attachmentMaxMb: number;
}

export interface StoredConnectionRecord {
  id: number;
  userId: number;
  provider: string;
  config: TitanConnectionConfig;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProviderKey = 'titan';
