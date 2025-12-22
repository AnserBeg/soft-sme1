import crypto from 'crypto';
import express from 'express';
import { qboHttp } from '../utils/qboHttp';
import { pool, runWithTenantContext } from '../db';
import { encryptQboConnectionFields } from '../utils/qboCrypto';
import { getCompanyIdFromRequest } from '../utils/companyContext';
import { resolveTenantCompanyId } from '../utils/tenantCompany';
import { ensureFreshQboAccess } from '../utils/qboTokens';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

// QuickBooks OAuth2 URLs
const AUTHORIZATION_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const DEFAULT_FRONTEND_BASE_URL = 'http://localhost:3000';
const FRONTEND_REDIRECT_ALLOWLIST = new Set(
  [
    DEFAULT_FRONTEND_BASE_URL,
    'https://softsme.phoenixtrailers.ca',
    'https://app.aivenerp.com',
    'https://soft-smetest-front.onrender.com',
    process.env.CORS_ORIGIN,
  ].filter(Boolean)
);

const getFrontendBaseUrl = (): string => {
  const candidate = process.env.CORS_ORIGIN || DEFAULT_FRONTEND_BASE_URL;
  return FRONTEND_REDIRECT_ALLOWLIST.has(candidate) ? candidate : DEFAULT_FRONTEND_BASE_URL;
};

const buildFrontendRedirectUrl = (pathWithQuery: string): string => {
  if (!pathWithQuery.startsWith('/')) {
    throw new Error('Frontend redirect path must be relative');
  }
  return new URL(pathWithQuery, getFrontendBaseUrl()).toString();
};

const buildFrontendErrorRedirect = (message: string): string => {
  const safeMessage = encodeURIComponent(message || 'QuickBooks connection failed');
  return buildFrontendRedirectUrl(`/business-profile?qbo_status=error&qbo_message=${safeMessage}`);
};

type QboStatePayload = {
  companyId: string;
  nonce: string;
  ts: number;
};

const getStateSecret = (): string =>
  process.env.QBO_STATE_SECRET || process.env.QBO_CLIENT_SECRET || '';

const requireQboAuthConfig = (): { clientId: string; redirectUri: string } => {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI || '';
  if (!clientId || !redirectUri) {
    throw new Error('Missing QBO OAuth configuration');
  }
  return { clientId, redirectUri };
};

const buildQboAuthUrl = (companyId: number): string => {
  const { clientId, redirectUri } = requireQboAuthConfig();
  const scope = 'com.intuit.quickbooks.accounting';
  const state = encodeState({
    companyId: String(companyId),
    nonce: crypto.randomBytes(16).toString('hex'),
    ts: Date.now(),
  });

  return `${AUTHORIZATION_URL}?client_id=${clientId}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}`;
};

const encodeState = (payload: QboStatePayload): string => {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error('Missing QBO state secret');
  }

  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
};

const decodeState = (state: unknown): QboStatePayload | null => {
  if (!state || typeof state !== 'string') {
    return null;
  }

  const [data, signature] = state.split('.');
  if (!data || !signature) {
    return null;
  }

  const secret = getStateSecret();
  if (!secret) {
    return null;
  }

  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (expected !== signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as QboStatePayload;
    if (!parsed || typeof parsed.companyId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

// Step 1: Redirect to QBO OAuth2 authorization URL
router.get('/auth', authMiddleware, (req, res) => {
  const companyId = getCompanyIdFromRequest(req);
  if (!companyId) {
    return res.redirect(buildFrontendErrorRedirect('Missing company context'));
  }

  try {
    const url = buildQboAuthUrl(companyId);
    return res.redirect(url);
  } catch (error) {
    console.error('Failed to build QBO OAuth state:', error instanceof Error ? error.message : String(error));
    return res.redirect(buildFrontendErrorRedirect('Failed to start QuickBooks connection'));
  }
});

// Step 1a: Return the QBO OAuth2 authorization URL for SPA redirects
router.get('/auth-url', authMiddleware, (req, res) => {
  const companyId = getCompanyIdFromRequest(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Missing company context' });
  }

  try {
    const url = buildQboAuthUrl(companyId);
    return res.json({ url });
  } catch (error) {
    console.error('Failed to build QBO OAuth URL:', error instanceof Error ? error.message : String(error));
    return res.status(400).json({ error: 'Failed to start QuickBooks connection' });
  }
});

// Step 2: Handle OAuth2 callback and token exchange
router.get('/callback', async (req, res) => {
  const { code, realmId, state } = req.query;
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI || '';

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Missing QBO OAuth configuration for callback.');
    return res.redirect(buildFrontendErrorRedirect('Missing QuickBooks OAuth configuration'));
  }

  if (!process.env.QBO_TOKEN_SECRET) {
    console.error('Missing QBO_TOKEN_SECRET for encryption.');
    return res.redirect(buildFrontendErrorRedirect('Missing QuickBooks token secret'));
  }

  const statePayload = decodeState(state);

  if (!code || !realmId || !statePayload) {
    // Redirect to frontend with error
    return res.redirect(buildFrontendErrorRedirect('Missing authorization code or realm ID'));
  }

  try {
    await runWithTenantContext(statePayload.companyId, async () => {
      const tenantCompanyId = await resolveTenantCompanyId(pool, statePayload.companyId);
      const companyId = tenantCompanyId ? Number(tenantCompanyId) : NaN;
      if (!Number.isInteger(companyId)) {
        throw new Error('Missing company context');
      }

      // Exchange authorization code for tokens (Intuit requires form-encoded body)
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      });
      const tokenResponse = await qboHttp.post(TOKEN_URL, tokenBody.toString(), {
        auth: {
          username: clientId!,
          password: clientSecret!,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      console.log('Storing QBO tokens for company_id:', companyId);

      const encrypted = await encryptQboConnectionFields({
        realmId: String(realmId),
        accessToken: access_token,
        refreshToken: refresh_token,
      });

      // Store tokens in database
      await pool.query(
        `INSERT INTO qbo_connection (company_id, realm_id, access_token, refresh_token, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (company_id) DO UPDATE SET
           realm_id = EXCLUDED.realm_id,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [companyId, encrypted.realmId, encrypted.accessToken, encrypted.refreshToken, new Date(Date.now() + expires_in * 1000)]
      );

      // Redirect to frontend with success
      res.redirect(
        buildFrontendRedirectUrl(
          '/business-profile?qbo_status=success&qbo_message=Successfully+connected+to+QuickBooks+Online'
        )
      );
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const responseStatus = error?.response?.status;
    const responseData = error?.response?.data;
    const responseError =
      responseData?.error_description || responseData?.error || responseData?.Fault?.Error?.[0]?.Message;

    console.error('Error exchanging authorization code for tokens:', {
      message: errorMessage,
      status: responseStatus,
      data: responseData,
    });

    const redirectMessage = responseError
      ? `QuickBooks connection failed: ${responseError}`
      : 'Failed to complete QuickBooks connection';
    // Redirect to frontend with error
    res.redirect(buildFrontendErrorRedirect(redirectMessage));
  }
});

// Check connection status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const requestedCompanyId = getCompanyIdFromRequest(req);
    if (!requestedCompanyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    await runWithTenantContext(String(requestedCompanyId), async () => {
      const tenantCompanyId = await resolveTenantCompanyId(pool, String(requestedCompanyId));
      const companyId = tenantCompanyId ? Number(tenantCompanyId) : NaN;
      if (!Number.isInteger(companyId)) {
        throw new Error('Missing company context');
      }

      console.log('Checking QBO connection status for company_id:', companyId);
      
      const result = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]);
      console.log('QBO connection query result:', result.rows.length, 'rows found');
      
      if (result.rows.length === 0) {
        console.log('No QBO connection found for company_id:', companyId);
        res.json({ connected: false });
        return;
      }
      
      let accessContext;
      try {
        accessContext = await ensureFreshQboAccess(pool, result.rows[0], companyId);
      } catch (refreshError) {
        console.error(
          'Error refreshing QBO token during status check:',
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        );
        res.status(401).json({
          connected: false,
          isExpired: true,
          error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.',
        });
        return;
      }

      const isExpired = accessContext.expiresAt < new Date();
      
      console.log('QBO connection found:', {
        companyId,
        isExpired,
        expiresAt: accessContext.expiresAt
      });
      
      res.json({
        connected: true,
        expiresAt: accessContext.expiresAt,
        isExpired
      });
    });
  } catch (error) {
    console.error('Error checking QBO connection status:', error);
    res.status(500).json({ error: 'Failed to check connection status' });
  }
});

export default router; 
