import { Pool } from 'pg';
import { qboHttp } from './qboHttp';
import { decryptQboValue, encryptQboConnectionFields } from './qboCrypto';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type QboConnectionRow = {
  company_id: number;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string | Date;
};

type QboAccessContext = {
  realmId: string;
  accessToken: string;
  expiresAt: Date;
};

const parseRefreshBufferMs = (): number => {
  const raw = Number(process.env.QBO_REFRESH_BUFFER_MS ?? '');
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_REFRESH_BUFFER_MS;
};

const isExpiringSoon = (expiresAt: Date, bufferMs: number): boolean =>
  expiresAt.getTime() - Date.now() <= bufferMs;

const requireQboClientCredentials = () => {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing QBO client credentials');
  }
  return { clientId, clientSecret };
};

export const ensureFreshQboAccess = async (
  pool: Pool,
  row: QboConnectionRow,
  companyId: number
): Promise<QboAccessContext> => {
  const expiresAt = new Date(row.expires_at);
  const bufferMs = parseRefreshBufferMs();
  const realmId = await decryptQboValue(row.realm_id);
  let accessToken = await decryptQboValue(row.access_token);

  try {
    if (!isExpiringSoon(expiresAt, bufferMs)) {
      return { realmId, accessToken, expiresAt };
    }

    const { clientId, clientSecret } = requireQboClientCredentials();
    let refreshToken = await decryptQboValue(row.refresh_token);

    const refreshResponse = await qboHttp.post(
      TOKEN_URL,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = refreshResponse.data;
    const newExpiresAt = new Date(Date.now() + Number(expires_in) * 1000);

    const encrypted = await encryptQboConnectionFields({
      realmId,
      accessToken: access_token,
      refreshToken: refresh_token,
    });

    await pool.query(
      `UPDATE qbo_connection SET 
       realm_id = $1, access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW() 
       WHERE company_id = $5`,
      [encrypted.realmId, encrypted.accessToken, encrypted.refreshToken, newExpiresAt, companyId]
    );

    accessToken = access_token;
    refreshToken = '';

    return { realmId, accessToken, expiresAt: newExpiresAt };
  } finally {
    row.access_token = '';
    row.refresh_token = '';
    row.realm_id = '';
  }
};

export const revokeQboRefreshToken = async (refreshToken: string): Promise<void> => {
  const { clientId, clientSecret } = requireQboClientCredentials();
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });

  await qboHttp.post('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', body.toString(), {
    auth: {
      username: clientId,
      password: clientSecret,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
};
