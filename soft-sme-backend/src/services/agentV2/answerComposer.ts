export type ToolResultType = 'success' | 'disambiguation' | 'empty' | 'error';
export type ToolResultSource = 'database' | 'doc' | 'action';

export interface ToolQueryMetadata {
  entity_type?: string | null;
  entity_name?: string | null;
  order_number?: string | null;
  filters?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ToolAttemptMetadata {
  exact: boolean;
  fuzzy: boolean;
  schema_refreshed: boolean;
}

export interface ToolDisambiguationCandidate {
  id: unknown;
  display_name: string;
  [key: string]: unknown;
}

export interface ToolErrorMetadata {
  code: string;
  message: string;
}

export interface ToolResultEnvelope {
  type: ToolResultType;
  source: ToolResultSource;
  query?: ToolQueryMetadata;
  rows?: any[];
  total_rows?: number;
  candidates?: ToolDisambiguationCandidate[];
  attempts?: ToolAttemptMetadata;
  error?: ToolErrorMetadata;
}

export interface AgentCapabilitiesConfig {
  canCreateVendor: boolean;
  canCreateCustomer: boolean;
  canCreatePart: boolean;
}

export interface ComposeFinalMessageInput {
  userText: string;
  tool: string;
  resultEnvelope: ToolResultEnvelope;
  capabilities: AgentCapabilitiesConfig;
}

export interface ComposeFinalMessageOutput {
  text: string;
  uiHints?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error';
}

const DEFAULT_ATTEMPTS: ToolAttemptMetadata = { exact: false, fuzzy: false, schema_refreshed: false };

const ENTITY_LABELS: Record<string, { singular: string; plural: string }> = {
  vendor: { singular: 'vendor', plural: 'vendors' },
  customer: { singular: 'customer', plural: 'customers' },
  part: { singular: 'part', plural: 'parts' },
  purchase_order: { singular: 'purchase order', plural: 'purchase orders' },
  sales_order: { singular: 'sales order', plural: 'sales orders' },
  quote: { singular: 'quote', plural: 'quotes' },
};

const TABLE_COLUMN_MAP: Record<string, Array<{ key: string; label: string }>> = {
  vendor: [
    { key: 'vendor_id', label: 'ID' },
    { key: 'vendor_name', label: 'Name' },
    { key: 'contact_person', label: 'Contact' },
    { key: 'telephone_number', label: 'Phone' },
    { key: 'email', label: 'Email' },
  ],
  customer: [
    { key: 'customer_id', label: 'ID' },
    { key: 'customer_name', label: 'Name' },
    { key: 'contact_person', label: 'Contact' },
    { key: 'telephone_number', label: 'Phone' },
    { key: 'email', label: 'Email' },
  ],
  part: [
    { key: 'part_id', label: 'ID' },
    { key: 'part_number', label: 'Part #' },
    { key: 'part_description', label: 'Description' },
    { key: 'quantity_on_hand', label: 'On hand' },
    { key: 'last_unit_cost', label: 'Last cost' },
  ],
  purchase_order: [
    { key: 'purchase_id', label: 'ID' },
    { key: 'purchase_number', label: 'PO #' },
    { key: 'status', label: 'Status' },
    { key: 'purchase_date', label: 'Date' },
    { key: 'vendor_name', label: 'Vendor' },
  ],
  sales_order: [
    { key: 'sales_order_id', label: 'ID' },
    { key: 'sales_order_number', label: 'SO #' },
    { key: 'status', label: 'Status' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'product_name', label: 'Product' },
  ],
  quote: [
    { key: 'quote_id', label: 'ID' },
    { key: 'quote_number', label: 'Quote #' },
    { key: 'status', label: 'Status' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'product_name', label: 'Product' },
  ],
};

const SUGGESTED_NEXT_STEPS: Record<string, string[]> = {
  vendor: ['Create a purchase order or view the vendor profile.'],
  customer: ['Create a sales order, quote, or view the full customer profile.'],
  part: ['Review stock levels or include the part in a purchase order.'],
  purchase_order: ['Open the purchase order to review line items or receive goods.'],
  sales_order: ['Review fulfillment status or convert to an invoice if needed.'],
  quote: ['Follow up with the customer or convert the quote to a sales order.'],
};

const capitalize = (value: string): string => {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const formatEntityLabel = (entityType?: string | null): { singular: string; plural: string } => {
  if (!entityType) {
    return { singular: 'record', plural: 'records' };
  }
  const normalized = entityType.toLowerCase();
  if (ENTITY_LABELS[normalized]) {
    return ENTITY_LABELS[normalized];
  }
  return { singular: normalized, plural: `${normalized}s` };
};

const pickBestIdentifier = (input: ComposeFinalMessageInput, rows: any[]): string | null => {
  const query = input.resultEnvelope.query || {};
  const directKeys = ['entity_name', 'order_number', 'part_identifier'];
  for (const key of directKeys) {
    const value = typeof query[key] === 'string' ? String(query[key]).trim() : '';
    if (value.length > 0) {
      return value;
    }
  }

  const firstRow = rows?.[0];
  if (!firstRow || typeof firstRow !== 'object') {
    return null;
  }

  const candidateKeys = [
    'vendor_name',
    'customer_name',
    'part_number',
    'part_description',
    'purchase_number',
    'sales_order_number',
    'quote_number',
    'name',
    'title',
  ];

  for (const key of candidateKeys) {
    const value = typeof firstRow[key] === 'string' ? firstRow[key].trim() : '';
    if (value) {
      return value;
    }
  }

  return null;
};

const buildTablePreview = (entityType: string | undefined, rows: any[] | undefined) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }

  const normalized = entityType ? entityType.toLowerCase() : undefined;
  const columnTemplate = (normalized && TABLE_COLUMN_MAP[normalized]) || null;

  if (!columnTemplate) {
    return undefined;
  }

  const activeColumns = columnTemplate.filter((column) => rows.some((row) => row[column.key] !== undefined));
  if (!activeColumns.length) {
    return undefined;
  }

  const previewRows = rows.map((row) => {
    const reduced: Record<string, unknown> = {};
    for (const column of activeColumns) {
      if (Object.prototype.hasOwnProperty.call(row, column.key)) {
        reduced[column.key] = row[column.key];
      }
    }
    return reduced;
  });

  return {
    columns: activeColumns,
    rows: previewRows,
  };
};

const formatDisambiguationLine = (candidate: ToolDisambiguationCandidate, index: number): string => {
  const details: string[] = [];
  const keys = Object.keys(candidate).filter((key) => !['display_name', 'id'].includes(key));
  for (const key of keys) {
    const value = candidate[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }
    details.push(`${key.replace(/_/g, ' ')} ${value}`);
  }
  const suffix = details.length ? ` — ${details.join(' · ')}` : '';
  const idDetail = candidate.id !== undefined && candidate.id !== null ? ` — ${candidate.id}` : '';
  return `${index + 1}) ${candidate.display_name}${idDetail}${suffix}`;
};

const buildWhatITried = (attempts: ToolAttemptMetadata): string[] => {
  const lines: string[] = [];
  if (attempts.exact) {
    lines.push('Tried exact match.');
  }
  if (attempts.fuzzy) {
    lines.push('Also tried a partial (fuzzy) match.');
  }
  if (attempts.schema_refreshed) {
    lines.push('Refreshed schema and retried.');
  }
  return lines;
};

const buildCreationGuidance = (entityType: string | undefined, capabilities: AgentCapabilitiesConfig, entityName: string | null): string | null => {
  const normalized = entityType ? entityType.toLowerCase() : '';
  const quotedName = entityName ? ` '${entityName}'` : '';
  switch (normalized) {
    case 'vendor':
      return capabilities.canCreateVendor
        ? `I can create a new vendor${quotedName}—say 'Add vendor${entityName ? ` ${entityName}` : ''}'.`
        : 'You may need to add this vendor via the UI: Vendors → Add New.';
    case 'customer':
      return capabilities.canCreateCustomer
        ? `I can create a new customer${quotedName}—say 'Add customer${entityName ? ` ${entityName}` : ''}'.`
        : 'You may need to add this customer via the UI: Customers → Add New.';
    case 'part':
      return capabilities.canCreatePart
        ? `I can create a new part${quotedName}—say 'Add part${entityName ? ` ${entityName}` : ''}'.`
        : 'You may need to add this part via the UI: Inventory → Add Part.';
    default:
      return null;
  }
};

const ensureAttempts = (attempts?: ToolAttemptMetadata): ToolAttemptMetadata => ({
  ...DEFAULT_ATTEMPTS,
  ...(attempts || {}),
});

const formatSummaryCount = (count: number, plural: string): string => {
  if (count === 1) {
    return '(1 record)';
  }
  return `(${count} records)`;
};

const normalizeEntityType = (entityType?: string | null): string | undefined => {
  if (!entityType) {
    return undefined;
  }
  return entityType.toLowerCase();
};

export function composeFinalMessage(input: ComposeFinalMessageInput): ComposeFinalMessageOutput {
  const { resultEnvelope, capabilities } = input;
  const entityType = normalizeEntityType(resultEnvelope.query?.entity_type as string | undefined);
  const attempts = ensureAttempts(resultEnvelope.attempts);
  const label = formatEntityLabel(entityType);
  const uiHints: Record<string, unknown> = {};

  switch (resultEnvelope.type) {
    case 'success': {
      const rows = Array.isArray(resultEnvelope.rows) ? resultEnvelope.rows : [];
      const totalRows = typeof resultEnvelope.total_rows === 'number' ? resultEnvelope.total_rows : rows.length;
      const identifier = pickBestIdentifier(input, rows);
      const summarySubject = identifier ? `'${identifier}'` : label.singular;
      const summary = `${capitalize(label.singular)} ${summarySubject} found ${formatSummaryCount(Math.max(totalRows, 1), label.plural)}.`;

      const tablePreview = buildTablePreview(entityType, rows);
      if (tablePreview) {
        uiHints.table = tablePreview;
      }

      const nextSteps = SUGGESTED_NEXT_STEPS[entityType ?? ''] || [];
      if (nextSteps.length) {
        uiHints.nextSteps = nextSteps;
      }

      const lines = [summary];
      if (nextSteps.length) {
        lines.push('Next steps:');
        for (const step of nextSteps) {
          lines.push(`• ${step}`);
        }
      }

      return {
        text: lines.join('\n'),
        uiHints: Object.keys(uiHints).length ? uiHints : undefined,
        severity: 'info',
      };
    }
    case 'disambiguation': {
      const candidates = Array.isArray(resultEnvelope.candidates) ? resultEnvelope.candidates : [];
      uiHints.disambiguation = candidates;

      const header = `Did you mean one of these ${label.plural}?`;
      const lines = [header];
      candidates.forEach((candidate, index) => {
        lines.push(formatDisambiguationLine(candidate, index));
      });
      lines.push('Reply with the number or the exact name.');

      return {
        text: lines.join('\n'),
        uiHints,
        severity: 'info',
      };
    }
    case 'empty': {
      const identifier = pickBestIdentifier(input, []);
      const headline = `No ${label.singular} named ${identifier ? `'${identifier}'` : 'that'} was found.`;
      const triedLines = buildWhatITried(attempts);
      const lines = [headline];
      if (triedLines.length) {
        lines.push('What I tried:');
        triedLines.forEach((line) => lines.push(`• ${line}`));
      }

      const nextSteps: string[] = [];
      if (!attempts.fuzzy) {
        nextSteps.push('Try a longer name or a more unique part of the name.');
      }

      const creationGuidance = buildCreationGuidance(entityType, capabilities, identifier);
      if (creationGuidance) {
        nextSteps.push(creationGuidance);
      }

      if (nextSteps.length) {
        uiHints.nextSteps = nextSteps;
        lines.push('Next steps:');
        nextSteps.forEach((step) => lines.push(`• ${step}`));
      }

      if (Object.keys(uiHints).length) {
        uiHints.attempts = attempts;
      } else if (triedLines.length) {
        uiHints.attempts = attempts;
      }

      return {
        text: lines.join('\n'),
        uiHints: Object.keys(uiHints).length ? uiHints : undefined,
        severity: 'warning',
      };
    }
    case 'error': {
      const errorCode = resultEnvelope.error?.code || 'UNKNOWN';
      const normalizedCode = errorCode.toUpperCase();
      let message: string;

      if (normalizedCode.includes('INVALID')) {
        message =
          resultEnvelope.error?.message?.trim().length
            ? resultEnvelope.error!.message
            : 'The request is missing required information. Please try again with more detail.';
      } else if (normalizedCode.includes('PERMISSION') || normalizedCode.includes('AUTH')) {
        message = "I don't have permission to view this data. Please check your role or ask an admin.";
      } else if (
        normalizedCode.includes('SCHEMA') ||
        normalizedCode.includes('DDL') ||
        normalizedCode.includes('REFRESH')
      ) {
        message =
          "The data source changed and I couldn't recover after a refresh. Please try again in a moment or contact an admin.";
      } else {
        message = `Sorry, the request failed because of a system error (${normalizedCode}). Please try again later or contact an admin.`;
      }

      return {
        text: message,
        severity: 'error',
      };
    }
    default: {
      return {
        text: 'I was not able to interpret the tool result.',
        severity: 'error',
      };
    }
  }
}

