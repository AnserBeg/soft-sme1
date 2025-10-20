import crypto from 'crypto';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { EmailSecretBox } from './crypto';
import type { ComposeEmailPayload, DraftRecord, EmailDraftPreview, ProviderKey } from './types';

interface StoredDraftRow {
  id: string;
  user_id: number;
  provider: string;
  draft_encrypted: string;
  draft_nonce: string;
  confirm_token: string;
  confirm_token_expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

const CONFIRM_WINDOW_MINUTES = 15;

const computeTokenHash = (token: string): string => {
  return crypto.createHash('sha256').update(token, 'utf8').digest('base64');
};

const now = () => new Date();

const buildPreview = (payload: ComposeEmailPayload): EmailDraftPreview => {
  const snippetSource = payload.textBody || payload.htmlBody || '';
  const stripped = snippetSource.replace(/<[^>]+>/g, ' ');
  const normalized = stripped.replace(/\s+/g, ' ').trim();
  const snippet = normalized.slice(0, 240);

  return {
    subject: payload.subject,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    snippet,
    attachments:
      payload.attachments?.map((attachment, index) => ({
        id: `${index}`,
        filename: attachment.filename,
        contentType: attachment.contentType || 'application/octet-stream',
        size: attachment.content ? Buffer.byteLength(attachment.content, attachment.encoding || 'utf8') : 0,
        inline: attachment.inline,
        cid: attachment.cid,
      })) || [],
    confirmToken: '',
  };
};

const decodeRow = async (
  row: StoredDraftRow,
  cryptoBox: EmailSecretBox
): Promise<{ payload: ComposeEmailPayload; preview: EmailDraftPreview; expiresAt: Date }> => {
  const decrypted = await cryptoBox.decrypt({ nonce: row.draft_nonce, ciphertext: row.draft_encrypted });
  const parsed = JSON.parse(decrypted) as { payload: ComposeEmailPayload; preview: Omit<EmailDraftPreview, 'confirmToken'> };
  const preview: EmailDraftPreview = { ...parsed.preview, confirmToken: '' };
  return {
    payload: parsed.payload,
    preview,
    expiresAt: new Date(row.confirm_token_expires_at),
  };
};

export class AgentEmailDraftStore {
  constructor(private readonly pool: Pool, private readonly crypto: EmailSecretBox) {}

  async createDraft(
    userId: number,
    provider: ProviderKey,
    payload: ComposeEmailPayload
  ): Promise<{ draftId: string; preview: EmailDraftPreview; confirmToken: string; expiresAt: Date }> {
    const draftId = uuidv4();
    const confirmToken = crypto.randomBytes(24).toString('base64url');
    const confirmTokenHash = computeTokenHash(confirmToken);
    const preview = buildPreview(payload);
    const expiresAt = new Date(now().getTime() + CONFIRM_WINDOW_MINUTES * 60 * 1000);

    const encrypted = await this.crypto.encrypt(JSON.stringify({ payload, preview: { ...preview, confirmToken: undefined } }));

    await this.pool.query(
      `INSERT INTO agent_email_drafts (id, user_id, provider, draft_encrypted, draft_nonce, confirm_token, confirm_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id)
       DO UPDATE SET
         draft_encrypted = EXCLUDED.draft_encrypted,
         draft_nonce = EXCLUDED.draft_nonce,
         confirm_token = EXCLUDED.confirm_token,
         confirm_token_expires_at = EXCLUDED.confirm_token_expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [draftId, userId, provider, encrypted.ciphertext, encrypted.nonce, confirmTokenHash, expiresAt]
    );

    return { draftId, preview: { ...preview, confirmToken }, confirmToken, expiresAt };
  }

  async verifyAndConsumeDraft(
    userId: number,
    provider: ProviderKey,
    draftId: string,
    confirmToken: string
  ): Promise<{ payload: ComposeEmailPayload; preview: EmailDraftPreview }> {
    const result = await this.pool.query<StoredDraftRow>(
      `SELECT id, user_id, provider, draft_encrypted, draft_nonce, confirm_token, confirm_token_expires_at, created_at, updated_at
         FROM agent_email_drafts
        WHERE id = $1 AND user_id = $2 AND provider = $3
        LIMIT 1`,
      [draftId, userId, provider]
    );

    if (result.rowCount === 0) {
      throw new Error('Draft not found or expired');
    }

    const row = result.rows[0];
    if (new Date(row.confirm_token_expires_at).getTime() < now().getTime()) {
      await this.deleteDraft(draftId);
      throw new Error('Confirmation window expired. Please compose a new email draft.');
    }

    const providedHash = computeTokenHash(confirmToken);
    if (providedHash !== row.confirm_token) {
      throw new Error('Invalid confirmation token for email send.');
    }

    await this.deleteDraft(draftId);
    const decoded = await decodeRow(row, this.crypto);
    return decoded;
  }

  async getDraft(
    userId: number,
    provider: ProviderKey,
    draftId: string
  ): Promise<DraftRecord | null> {
    const result = await this.pool.query<StoredDraftRow>(
      `SELECT id, user_id, provider, draft_encrypted, draft_nonce, confirm_token, confirm_token_expires_at, created_at, updated_at
         FROM agent_email_drafts
        WHERE id = $1 AND user_id = $2 AND provider = $3
        LIMIT 1`,
      [draftId, userId, provider]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    const decoded = await decodeRow(row, this.crypto);
    return {
      id: row.id,
      provider: row.provider,
      userId: row.user_id,
      payload: decoded.payload,
      preview: decoded.preview,
      confirmToken: '',
      expiresAt: decoded.expiresAt,
    };
  }

  private async deleteDraft(draftId: string): Promise<void> {
    await this.pool.query('DELETE FROM agent_email_drafts WHERE id = $1', [draftId]);
  }
}
