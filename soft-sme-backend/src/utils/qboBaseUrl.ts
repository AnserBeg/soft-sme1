const PROD_QBO_BASE_URL = 'https://quickbooks.api.intuit.com';
const SANDBOX_QBO_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com';

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const getQboApiBaseUrl = (): string => {
  const explicit = process.env.QBO_API_BASE_URL || process.env.QBO_API_BASE || '';
  if (explicit) {
    return stripTrailingSlash(explicit);
  }

  const env = (process.env.QBO_ENV || process.env.QBO_ENVIRONMENT || '').toLowerCase();
  if (env === 'sandbox') {
    return SANDBOX_QBO_BASE_URL;
  }

  return PROD_QBO_BASE_URL;
};
