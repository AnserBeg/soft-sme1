import { Pool } from 'pg';
import type { EmailPolicyConfig } from './types';

const DEFAULT_POLICY: EmailPolicyConfig = {
  emailEnabled: true,
  emailSendEnabled: true,
  allowExternal: false,
  attachmentMaxMb: 25,
};

const parseBoolean = (value: string | null | undefined, fallback: boolean): boolean => {
  if (value == null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'enabled', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'f', 'no', 'n', 'disabled', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parseNumber = (value: string | null | undefined, fallback: number): number => {
  if (value == null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export class EmailPolicyService {
  constructor(private readonly pool: Pool) {}

  async getPolicy(): Promise<EmailPolicyConfig> {
    const keys = ['EMAIL_ENABLED', 'EMAIL_SEND_ENABLED', 'EMAIL_ALLOW_EXTERNAL', 'EMAIL_ATTACHMENT_MAX_MB'];
    const result = await this.pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM global_settings WHERE key = ANY($1::text[])`,
      [keys]
    );

    const lookup = new Map<string, string>();
    for (const row of result.rows) {
      lookup.set(row.key, row.value);
    }

    return {
      emailEnabled: parseBoolean(lookup.get('EMAIL_ENABLED'), DEFAULT_POLICY.emailEnabled),
      emailSendEnabled: parseBoolean(lookup.get('EMAIL_SEND_ENABLED'), DEFAULT_POLICY.emailSendEnabled),
      allowExternal: parseBoolean(lookup.get('EMAIL_ALLOW_EXTERNAL'), DEFAULT_POLICY.allowExternal),
      attachmentMaxMb: parseNumber(lookup.get('EMAIL_ATTACHMENT_MAX_MB'), DEFAULT_POLICY.attachmentMaxMb),
    };
  }
}
