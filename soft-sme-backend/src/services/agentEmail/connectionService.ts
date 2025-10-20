import { Pool } from 'pg';
import { EmailSecretBox } from './crypto';
import type { ProviderKey, StoredConnectionRecord, TitanConnectionConfig } from './types';

const mapRowToRecord = async (
  row: any,
  crypto: EmailSecretBox
): Promise<StoredConnectionRecord> => {
  const decrypted = await crypto.decrypt({
    nonce: row.config_nonce,
    ciphertext: row.config_encrypted,
  });
  const parsed = JSON.parse(decrypted) as TitanConnectionConfig;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    config: parsed,
    lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

export class AgentEmailConnectionService {
  constructor(private readonly pool: Pool, private readonly crypto: EmailSecretBox) {}

  async getConnection(userId: number, provider: ProviderKey): Promise<StoredConnectionRecord | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, provider, config_encrypted, config_nonce, last_validated_at, created_at, updated_at
         FROM agent_email_connections
        WHERE user_id = $1 AND provider = $2 AND is_active = true
        LIMIT 1`,
      [userId, provider]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRowToRecord(result.rows[0], this.crypto);
  }

  async saveConnection(userId: number, provider: ProviderKey, config: TitanConnectionConfig): Promise<StoredConnectionRecord> {
    const payload = JSON.stringify(config);
    const encrypted = await this.crypto.encrypt(payload);

    const result = await this.pool.query(
      `INSERT INTO agent_email_connections (user_id, provider, config_encrypted, config_nonce, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         config_encrypted = EXCLUDED.config_encrypted,
         config_nonce = EXCLUDED.config_nonce,
         is_active = true,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, user_id, provider, config_encrypted, config_nonce, last_validated_at, created_at, updated_at`,
      [userId, provider, encrypted.ciphertext, encrypted.nonce]
    );

    return mapRowToRecord(result.rows[0], this.crypto);
  }

  async deleteConnection(userId: number, provider: ProviderKey): Promise<void> {
    await this.pool.query(
      `UPDATE agent_email_connections
          SET is_active = false,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  }

  async markValidated(userId: number, provider: ProviderKey): Promise<void> {
    await this.pool.query(
      `UPDATE agent_email_connections
          SET last_validated_at = CURRENT_TIMESTAMP,
              is_active = true,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  }
}
