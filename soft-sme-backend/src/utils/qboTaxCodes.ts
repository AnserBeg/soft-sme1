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
          query: 'SELECT Id, Name FROM TaxCode WHERE Active = true',
          minorversion: '75'
        }
      }
    );

    const taxCodes = response.data.QueryResponse?.TaxCode || [];
    if (!Array.isArray(taxCodes) || taxCodes.length === 0) {
      return null;
    }

    const taxableCodes = taxCodes.filter((code: any) => !isNonTaxCodeName(String(code.Name || '')));
    if (taxableCodes.length === 0) {
      return null;
    }

    const exactMatch = taxableCodes.find((code: any) =>
      isTaxablePreferredName(String(code.Name || ''))
    );
    if (exactMatch?.Id) {
      return exactMatch.Id;
    }

    const partialMatch = taxableCodes.find((code: any) =>
      isTaxablePartialName(String(code.Name || ''))
    );
    return partialMatch?.Id || taxableCodes[0]?.Id || null;
  } catch (error) {
    console.error('Error fetching QBO tax codes:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
