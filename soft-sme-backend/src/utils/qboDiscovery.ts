import { qboHttp } from './qboHttp';

type QboDiscoveryConfig = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  issuer?: string;
};

const DEFAULT_DISCOVERY_URL = 'https://developer.api.intuit.com/.well-known/openid_configuration';
const FALLBACK_CONFIG: QboDiscoveryConfig = {
  authorizationEndpoint: 'https://appcenter.intuit.com/connect/oauth2',
  tokenEndpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revocationEndpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
};

const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

let cachedConfig: QboDiscoveryConfig | null = null;
let cachedAt = 0;

const getDiscoveryUrl = (): string =>
  process.env.QBO_DISCOVERY_URL || DEFAULT_DISCOVERY_URL;

const isCacheFresh = (): boolean =>
  Boolean(cachedConfig) && Date.now() - cachedAt < DISCOVERY_TTL_MS;

const normalizeDiscoveryConfig = (data: any): QboDiscoveryConfig => {
  const authorizationEndpoint = data?.authorization_endpoint;
  const tokenEndpoint = data?.token_endpoint;
  const revocationEndpoint = data?.revocation_endpoint;

  if (!authorizationEndpoint || !tokenEndpoint || !revocationEndpoint) {
    throw new Error('Discovery document missing required endpoints');
  }

  return {
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
    userinfoEndpoint: data?.userinfo_endpoint,
    jwksUri: data?.jwks_uri,
    issuer: data?.issuer,
  };
};

export const getQboDiscoveryConfig = async (): Promise<QboDiscoveryConfig> => {
  if (isCacheFresh()) {
    return cachedConfig!;
  }

  const discoveryUrl = getDiscoveryUrl();

  try {
    const response = await qboHttp.get(discoveryUrl, {
      headers: { Accept: 'application/json' },
    });
    cachedConfig = normalizeDiscoveryConfig(response.data);
    cachedAt = Date.now();
    return cachedConfig;
  } catch (error) {
    if (cachedConfig) {
      return cachedConfig;
    }
    console.error('Failed to load QBO discovery document:', error instanceof Error ? error.message : String(error));
    return FALLBACK_CONFIG;
  }
};

export const getQboAuthEndpoints = async () => {
  const config = await getQboDiscoveryConfig();
  return {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    revocationEndpoint: config.revocationEndpoint,
  };
};
