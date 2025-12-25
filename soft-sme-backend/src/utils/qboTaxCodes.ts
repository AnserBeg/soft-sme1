import { qboHttp } from './qboHttp';
import { getQboApiBaseUrl } from './qboBaseUrl';

const NON_TAX_TOKENS = ['non', 'non-taxable', 'nontaxable', 'exempt', 'zero', 'zero-rated'];
const TAXABLE_TOKENS = ['tax', 'taxable', 'gst', 'hst', 'pst', 'vat', 'sales tax'];

const isNonTaxCodeName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return NON_TAX_TOKENS.some((token) => normalized.includes(token));
};

const isTaxablePreferredName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return TAXABLE_TOKENS.includes(normalized);
};

const isTaxablePartialName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return TAXABLE_TOKENS.some((token) => normalized.includes(token));
};

const hasSalesTaxRates = (code: any): boolean => {
  const list = code?.SalesTaxRateList?.TaxRateDetail;
  return Array.isArray(list) && list.length > 0;
};

const getTaxCodeName = (code: any): string => String(code?.Name || '');

export const resolveTaxableQboTaxCodeId = async (
  accessToken: string,
  realmId: string
): Promise<string | null> => {
  try {
    const response = await qboHttp.get(
      `${getQboApiBaseUrl()}/v3/company/${realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: 'SELECT Id, Name, SalesTaxRateList FROM TaxCode WHERE Active = true',
          minorversion: '75'
        }
      }
    );

    const taxCodes = response.data.QueryResponse?.TaxCode || [];
    if (!Array.isArray(taxCodes) || taxCodes.length === 0) {
      return null;
    }

    const taxableCodes = taxCodes.filter((code: any) => !isNonTaxCodeName(getTaxCodeName(code)));
    if (taxableCodes.length === 0) {
      return null;
    }

    const salesTaxableCodes = taxableCodes.filter((code: any) => hasSalesTaxRates(code));
    const preferredPool = salesTaxableCodes.length > 0 ? salesTaxableCodes : taxableCodes;

    const exactMatch = preferredPool.find((code: any) =>
      isTaxablePreferredName(getTaxCodeName(code))
    );
    if (exactMatch?.Id) {
      return exactMatch.Id;
    }

    const partialMatch = preferredPool.find((code: any) =>
      isTaxablePartialName(getTaxCodeName(code))
    );
    return partialMatch?.Id || preferredPool[0]?.Id || null;
  } catch (error) {
    console.error('Error fetching QBO tax codes:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
