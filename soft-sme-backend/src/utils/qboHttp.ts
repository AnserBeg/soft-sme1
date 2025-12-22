import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const ALLOWED_QBO_HOSTS = new Set([
  'oauth.platform.intuit.com',
  'developer.api.intuit.com',
  'sandbox-quickbooks.api.intuit.com',
  'quickbooks.api.intuit.com'
]);

const resolveRequestUrl = (config: AxiosRequestConfig): string => {
  const requestUrl = config.url ?? '';
  if (!requestUrl) {
    return '';
  }

  if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
    return requestUrl;
  }

  if (config.baseURL) {
    return new URL(requestUrl, config.baseURL).toString();
  }

  return requestUrl;
};

const assertQboHost = (url: string) => {
  if (!url) {
    throw new Error('QBO request missing URL');
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch (error) {
    throw new Error('QBO request URL is invalid');
  }

  if (!ALLOWED_QBO_HOSTS.has(hostname)) {
    throw new Error(`Blocked QBO request to non-Intuit host: ${hostname}`);
  }
};

const createQboHttpClient = (): AxiosInstance => {
  const client = axios.create();
  client.interceptors.request.use((config) => {
    const resolvedUrl = resolveRequestUrl(config);
    assertQboHost(resolvedUrl);
    return config;
  });
  return client;
};

const qboHttp = createQboHttpClient();

export { qboHttp };
