import dotenv from 'dotenv';
import path from 'path';
import {
  PurchaseOrderOcrIssue,
  PurchaseOrderOcrLineItem,
  PurchaseOrderOcrNormalizedData,
} from './PurchaseOrderOcrService';
import { PurchaseOrderOcrAssociationService } from './PurchaseOrderOcrAssociationService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface PurchaseOrderAiReviewOptions {
  userId?: number;
  heuristicNormalized?: PurchaseOrderOcrNormalizedData;
}

interface PurchaseOrderAiStructuredResponse {
  normalized: PurchaseOrderOcrNormalizedData;
  warnings: string[];
  notes: string[];
  issues?: PurchaseOrderOcrIssue[];
}

type ReviewMode = 'full' | 'headers_only';

const DEFAULT_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

const ABSOLUTE_MAX_OUTPUT_TOKENS = 24576;

const parseMaxOutputTokens = (): number => {
  const raw = process.env.AI_MAX_OUTPUT_TOKENS;
  if (!raw) {
    return 8192;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`Invalid AI_MAX_OUTPUT_TOKENS value "${raw}". Falling back to default.`);
    return 8192;
  }

  // Gemini 2.5 models support large outputs, but we cap to a safe ceiling to avoid runaway responses.
  return Math.max(512, Math.min(parsed, ABSOLUTE_MAX_OUTPUT_TOKENS));
};

const MAX_OUTPUT_TOKENS = parseMaxOutputTokens();

const MAX_LINE_ITEMS = 120;
const HEADER_ONLY_MAX_OUTPUT_TOKENS = 4096;

const SYSTEM_INSTRUCTIONS = `You are helping an inventory specialist capture purchase order details.
Extract structured data from raw invoice or packing slip text.
Keep the response compact: limit detectedKeywords to unique, relevant terms (maximum 20),
limit warnings and notes to 200 characters each, truncate rawLine or description values that exceed 512 characters with an ellipsis,
and include at most ${MAX_LINE_ITEMS} line items (prioritize the most complete entries and mention any omissions in warnings).
Return a JSON object that exactly matches the following schema:
{
  "normalized": {
    "vendorName": string | null,
    "vendorAddress": string | null,
    "billNumber": string | null,
    "billDate": string | null,
    "gstRate": number | null,
    "currency": string | null,
    "documentType": "invoice" | "packing_slip" | "receipt" | "unknown",
    "detectedKeywords": string[],
    "lineItems": Array<{
      "rawLine": string,
      "partNumber": string | null,
      "description": string,
      "quantity": number | null,
      "unit": string | null,
      "unitCost": number | null,
      "totalCost": number | null
    }>
  },
  "warnings": string[],
  "notes": string[]
}

Rules:
- Use null when information is missing or uncertain.
- Provide at least an empty array for warnings, notes, detectedKeywords, and lineItems.
- Document type must be one of the allowed strings.
- Do not include any explanatory text outside of the JSON.
- Preserve numeric values as numbers (not strings).
`;

export class PurchaseOrderAiReviewService {
  static async reviewRawText(
    rawText: string,
    options: PurchaseOrderAiReviewOptions = {},
  ): Promise<PurchaseOrderAiStructuredResponse> {
    const trimmed = rawText?.trim();
    if (!trimmed) {
      throw new Error('Raw text is required for AI review.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const attemptErrors: string[] = [];

    let maxTokens = MAX_OUTPUT_TOKENS;
    let useConcisePrompt = false;

    let mode: ReviewMode = 'full';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { result, errorSummary, sawMaxTokens, shouldRetry } = await this.requestAndParse({
        apiKey,
        rawDocument: trimmed,
        maxTokens,
        useConcisePrompt,
        mode,
        options,
      });

      if (result) {
        if (mode === 'headers_only') {
          this.ensureHeaderOnlyFallbackNote(result);
        }

        const enrichment = await PurchaseOrderOcrAssociationService.enrich({
          normalized: result.normalized,
          rawText: trimmed,
          heuristicNormalized: options.heuristicNormalized,
        });

        const combinedWarnings = new Set<string>([
          ...result.warnings,
          ...enrichment.warnings,
        ]);
          const combinedNotes = new Set<string>([
            ...result.notes,
            ...enrichment.notes,
          ]);
          const combinedIssues = [
            ...(result.issues || []),
            ...enrichment.issues,
          ];

          return {
            normalized: enrichment.normalized,
            warnings: Array.from(combinedWarnings),
            notes: Array.from(combinedNotes),
            issues: combinedIssues,
          };
      }

      attemptErrors.push(`[maxTokens=${maxTokens}${useConcisePrompt ? ', concise' : ''}] ${errorSummary}`);

      if (sawMaxTokens && maxTokens < ABSOLUTE_MAX_OUTPUT_TOKENS) {
        const nextTokens = Math.min(ABSOLUTE_MAX_OUTPUT_TOKENS, Math.max(maxTokens + 1024, maxTokens * 2));
        if (nextTokens > maxTokens) {
          maxTokens = nextTokens;
          continue;
        }
      }

      if (!useConcisePrompt) {
        useConcisePrompt = true;
        continue;
      }

      if (mode === 'full' && sawMaxTokens) {
        mode = 'headers_only';
        attemptErrors.push('Switching to header-only fallback after repeated MAX_TOKENS responses.');
        continue;
      }

      if (!shouldRetry) {
        break;
      }
    }

    throw new Error(`AI response could not be parsed after retries. Attempts: ${attemptErrors.join('; ')}`);
  }

  private static sortCandidates(candidates: any[]): any[] {
    if (!Array.isArray(candidates)) {
      return [];
    }

    const priority = (finishReason: string | undefined): number => {
      switch (finishReason) {
        case 'STOP':
          return 0;
        case 'MAX_TOKENS':
          return 1;
        case 'SAFETY':
          return 3;
        default:
          return 2;
      }
    };

    return [...candidates].sort((a, b) => {
      const aPriority = priority(a?.finishReason);
      const bPriority = priority(b?.finishReason);

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Prefer candidates with more tokens / parts when priorities match.
      const aParts = Array.isArray(a?.content?.parts) ? a.content.parts.length : 0;
      const bParts = Array.isArray(b?.content?.parts) ? b.content.parts.length : 0;

      return bParts - aParts;
    });
  }

  private static buildPrompt(rawDocument: string, concise: boolean, mode: ReviewMode): string {
    const fallbackInstructions =
      mode === 'headers_only'
        ? [
            'Fallback mode engaged: capture header level metadata only.',
            'Set normalized.lineItems to an empty array.',
            'Add a note explaining that line items were omitted due to response size limits.',
          ].join(' ')
        : '';

    if (!concise) {
      return `${SYSTEM_INSTRUCTIONS}${fallbackInstructions ? `\n${fallbackInstructions}` : ''}\n\nRAW DOCUMENT:\n${rawDocument}`;
    }

    const conciseInstructions = [
      'If earlier attempts were truncated, respond with shorter field values while preserving accuracy.',
      'Avoid repeating boilerplate text.',
      'Use the minimum characters required to convey each value.',
    ];

    if (fallbackInstructions) {
      conciseInstructions.push(fallbackInstructions);
    }

    return `${SYSTEM_INSTRUCTIONS}\n${conciseInstructions.join(' ')}\n\nRAW DOCUMENT:\n${rawDocument}`;
  }

  private static buildRequestBody(prompt: string, maxTokens: number, mode: ReviewMode) {
    const { responseSchema, maxOutputTokens } = this.buildSchemaConfig(maxTokens, mode);

    return {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topK: 32,
        topP: 0.9,
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema,
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_MEDIUM_AND_ABOVE',
        },
      ],
    };
  }

  private static async requestAndParse({
    apiKey,
    rawDocument,
    maxTokens,
    useConcisePrompt,
    mode,
    options,
  }: {
    apiKey: string;
    rawDocument: string;
    maxTokens: number;
    useConcisePrompt: boolean;
    mode: ReviewMode;
    options: PurchaseOrderAiReviewOptions;
  }): Promise<{
    result: PurchaseOrderAiStructuredResponse | null;
    errorSummary: string;
    sawMaxTokens: boolean;
    shouldRetry: boolean;
  }> {
    const prompt = this.buildPrompt(rawDocument, useConcisePrompt, mode);
    const requestBody = this.buildRequestBody(prompt, maxTokens, mode);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        result: null,
        errorSummary: `request failed: ${response.status} ${response.statusText} - ${errorText}`,
        sawMaxTokens: false,
        shouldRetry: false,
      };
    }

    const data = await response.json();
    const candidates = this.sortCandidates(data?.candidates);

    if (candidates.length === 0) {
      return {
        result: null,
        errorSummary: 'no candidates returned',
        sawMaxTokens: false,
        shouldRetry: mode === 'full',
      };
    }

    const { structured, errors, sawMaxTokens } = this.parseCandidates(candidates, options, mode);

    if (structured) {
      return { result: structured, errorSummary: '', sawMaxTokens, shouldRetry: false };
    }

    return {
      result: null,
      errorSummary: errors.length > 0 ? errors.join('; ') : 'candidates could not be parsed',
      sawMaxTokens,
      shouldRetry: sawMaxTokens && mode === 'full',
    };
  }

  private static parseCandidates(
    candidates: any[],
    options: PurchaseOrderAiReviewOptions,
    mode: ReviewMode,
  ): {
    structured: PurchaseOrderAiStructuredResponse | null;
    errors: string[];
    sawMaxTokens: boolean;
  } {
    const errors: string[] = [];
    let sawMaxTokens = false;

    for (const candidate of candidates) {
      const finishReason = candidate?.finishReason ?? 'unknown';
      if (finishReason === 'MAX_TOKENS') {
        sawMaxTokens = true;
      }

      const parts = candidate?.content?.parts ?? [];
      const structuredContent = this.extractStructuredContent(parts);

      if (!structuredContent) {
        errors.push(`no structured text (finish reason: ${finishReason})`);
        continue;
      }

      try {
        const structured = this.parseStructuredResponse(structuredContent, options, mode);
        return { structured, errors, sawMaxTokens };
      } catch (error) {
        if (typeof structuredContent === 'string' && this.looksLikeTruncatedJson(structuredContent)) {
          sawMaxTokens = true;
        }
        const message = error instanceof Error ? error.message : 'unknown error';
        errors.push(`parse failure (finish reason: ${finishReason}): ${message}`);
      }
    }

    return { structured: null, errors, sawMaxTokens };
  }

  private static pickBestCandidate(candidates: any[]): any | null {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    const hasStop = candidates.find((candidate) => candidate?.finishReason === 'STOP');
    if (hasStop) {
      return hasStop;
    }

    const nonSafety = candidates.find((candidate) => candidate?.finishReason !== 'SAFETY');
    if (nonSafety) {
      return nonSafety;
    }

    return candidates[0];
  }

  private static extractStructuredContent(parts: any[]): string | Record<string, unknown> | null {
    if (!Array.isArray(parts)) {
      return null;
    }

    const textParts: string[] = [];

    for (const part of parts) {
      const text = part?.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        textParts.push(text);
        continue;
      }

      const functionCallArgs = part?.functionCall?.args;
      if (functionCallArgs) {
        return functionCallArgs;
      }
    }

    if (textParts.length === 0) {
      return null;
    }

    return textParts.join('');
  }

  private static parseStructuredResponse(
    responseContent: string | Record<string, unknown>,
    _options: PurchaseOrderAiReviewOptions,
    mode: ReviewMode,
  ): PurchaseOrderAiStructuredResponse {
    const extractedJson = this.extractJson(responseContent);

      const normalized = this.buildNormalizedData(extractedJson?.normalized ?? {});
      const warnings = this.buildStringArray(extractedJson?.warnings);
      const notes = this.buildStringArray(extractedJson?.notes);

    if (mode === 'headers_only') {
      normalized.lineItems = [];
    }

    this.ensureDefaultWarnings(normalized, warnings, notes);

      return {
        normalized,
        warnings,
        notes,
        // Issues are added later by the association service.
        issues: undefined,
      };
  }

  private static extractJson(content: string | Record<string, unknown>): any {
    if (typeof content !== 'string') {
      return content;
    }

    const cleaned = this.cleanJsonText(content);

    for (const candidate of this.generateJsonCandidates(cleaned)) {
      const parsed = this.safeJsonParse(candidate);
      if (parsed) {
        return parsed;
      }
    }

    console.error('AI response parsing failed. Snippet:', cleaned.slice(0, 500));
    throw new Error('AI response could not be parsed as JSON.');
  }

  private static safeJsonParse(text: string): any | null {
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  private static looksLikeTruncatedJson(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith('{')) {
      return false;
    }

    // Detect unbalanced braces/brackets while respecting strings/escapes.
    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stack.pop();
        }
      }
    }

    return stack.length > 0 || inString;
  }

  private static cleanJsonText(content: string): string {
    return content
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .replace(/^[\uFEFF\u200B]+/, '')
      .trim();
  }

  private static escapeControlCharsInStrings(input: string): string {
    let inString = false;
    let escaped = false;
    let out = '';

    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];

      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }

      if (inString) {
        if (ch === '\n') {
          out += '\\n';
          continue;
        }
        if (ch === '\r') {
          out += '\\r';
          continue;
        }
        if (ch === '\t') {
          out += '\\t';
          continue;
        }
        const code = ch.charCodeAt(0);
        if (code >= 0 && code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
          continue;
        }
      }

      out += ch;
    }

    return out;
  }

  private static repairPossiblyTruncatedJson(input: string): string {
    const trimmed = input.trim();
    if (!trimmed.startsWith('{')) {
      return input;
    }

    let inString = false;
    let escaped = false;
    const closers: string[] = [];

    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }

      if (ch === '{') {
        closers.push('}');
      } else if (ch === '[') {
        closers.push(']');
      } else if (ch === '}' || ch === ']') {
        if (closers.length > 0 && closers[closers.length - 1] === ch) {
          closers.pop();
        }
      }
    }

    let fixed = trimmed;
    if (inString) {
      fixed += '"';
    }

    // Remove trailing backslash which would invalidate the closing quote we add above.
    if (fixed.endsWith('\\')) {
      fixed = fixed.slice(0, -1);
    }

    while (closers.length > 0) {
      fixed += closers.pop();
    }

    return fixed;
  }

  private static *generateJsonCandidates(initial: string): Iterable<string> {
    const attempts = new Set<string>();
    const queue: string[] = [initial];

    const applyTransforms = (value: string): string[] => {
      return [
        value,
        this.extractFirstJsonObject(value),
        this.escapeControlCharsInStrings(value),
        this.repairPossiblyTruncatedJson(value),
        this.stripTrailingCommas(value),
        this.ensureQuotedKeys(value),
        this.convertSingleQuotedStrings(value),
        this.stripTrailingCommas(this.repairPossiblyTruncatedJson(value)),
        this.stripTrailingCommas(this.ensureQuotedKeys(value)),
        this.stripTrailingCommas(this.convertSingleQuotedStrings(value)),
        this.convertSingleQuotedStrings(this.ensureQuotedKeys(value)),
        this.stripTrailingCommas(this.convertSingleQuotedStrings(this.ensureQuotedKeys(value))),
      ];
    };

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || attempts.has(current)) {
        continue;
      }

      attempts.add(current);
      yield current;

      for (const transformed of applyTransforms(current)) {
        if (!attempts.has(transformed)) {
          queue.push(transformed);
        }
      }
    }
  }

  private static stripTrailingCommas(input: string): string {
    return input.replace(/,\s*([}\]])/g, '$1');
  }

  private static ensureQuotedKeys(input: string): string {
    return input.replace(/([\{,]\s*)([A-Za-z0-9_]+)\s*:/g, (match, prefix, key) => {
      if (key.startsWith('"')) {
        return match;
      }
      return `${prefix}"${key}":`;
    });
  }

  private static convertSingleQuotedStrings(input: string): string {
    return input.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) => {
      const escaped = value.replace(/"/g, '\\"');
      return `"${escaped}"`;
    });
  }

  private static extractFirstJsonObject(input: string): string {
    const match = input.match(/\{[\s\S]*\}/);
    return match ? match[0] : input;
  }

  private static buildNormalizedData(input: any): PurchaseOrderOcrNormalizedData {
    const normalized: PurchaseOrderOcrNormalizedData = {
      vendorName: this.toNullableString(input?.vendorName),
      vendorAddress: this.toNullableString(input?.vendorAddress),
      billNumber: this.toNullableString(input?.billNumber),
      billDate: this.toNullableString(input?.billDate),
      gstRate: this.toNullableNumber(input?.gstRate),
      currency: this.toNullableString(input?.currency),
      documentType: this.normalizeDocumentType(input?.documentType),
      detectedKeywords: this.buildStringArray(input?.detectedKeywords),
      lineItems: this.buildLineItems(input?.lineItems),
    };

    return normalized;
  }

  private static buildStringArray(value: any): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => this.toNullableString(entry))
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => entry!);
  }

  private static buildLineItems(value: any): PurchaseOrderOcrLineItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items: PurchaseOrderOcrLineItem[] = [];

    for (const item of value) {
      const description = this.toNullableString(item?.description) ?? '';
      const rawLineCandidate = this.toNullableString(item?.rawLine) ?? description;

      if (!description && !rawLineCandidate) {
        continue;
      }

      items.push({
        rawLine: rawLineCandidate || description,
        partNumber: this.toNullableString(item?.partNumber),
        description,
        quantity: this.toNullableNumber(item?.quantity),
        unit: this.toNullableString(item?.unit),
        unitCost: this.toNullableNumber(item?.unitCost),
        totalCost: this.toNullableNumber(item?.totalCost),
      });
    }

    return items.slice(0, MAX_LINE_ITEMS);
  }

  private static toNullableString(value: any): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      const asString = String(value).trim();
      return asString.length > 0 ? asString : null;
    }
    return null;
  }

  private static toNullableNumber(value: any): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.+-]/g, '');
      if (!normalized) {
        return null;
      }
      const parsed = parseFloat(normalized);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private static normalizeDocumentType(value: any): 'invoice' | 'packing_slip' | 'receipt' | 'unknown' {
    if (typeof value !== 'string') {
      return 'unknown';
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'invoice') {
      return 'invoice';
    }
    if (normalized === 'packing_slip' || normalized === 'packing slip') {
      return 'packing_slip';
    }
    if (normalized === 'receipt') {
      return 'receipt';
    }
    return 'unknown';
  }

  private static ensureDefaultWarnings(
    normalized: PurchaseOrderOcrNormalizedData,
    warnings: string[],
    notes: string[],
  ): void {
    const pushUnique = (collection: string[], value: string) => {
      if (!collection.includes(value)) {
        collection.push(value);
      }
    };

    if (!normalized.vendorName) {
      pushUnique(warnings, 'Vendor name was not confidently detected.');
    }

    if (!normalized.billNumber) {
      pushUnique(warnings, 'Bill or invoice number was not detected.');
    }

    if (!normalized.billDate) {
      pushUnique(warnings, 'Bill date was not detected.');
    }

    if (normalized.gstRate === null) {
      pushUnique(notes, 'GST rate not found. Using existing purchase order default.');
    }

    if (normalized.lineItems.length === 0) {
      pushUnique(warnings, 'No line items were detected in the document.');
    }
  }

  private static ensureHeaderOnlyFallbackNote(result: PurchaseOrderAiStructuredResponse): void {
    const message = 'Line items were omitted due to response size limits. Please enter them manually.';
    const pushUnique = (collection: string[], value: string) => {
      if (!collection.includes(value)) {
        collection.push(value);
      }
    };

    pushUnique(result.notes, message);
  }

  private static buildSchemaConfig(maxTokens: number, mode: ReviewMode): {
    responseSchema: Record<string, unknown>;
    maxOutputTokens: number;
  } {
    const baseString = (options: { nullable?: boolean } = {}) => {
      const schema: Record<string, unknown> = { type: 'STRING' };
      if (options.nullable) {
        schema.nullable = true;
      }
      return schema;
    };

    const numberSchema: Record<string, unknown> = { type: 'NUMBER', nullable: true };

    const lineItemSchema: Record<string, unknown> = {
      type: 'OBJECT',
      properties: {
        rawLine: baseString(),
        partNumber: baseString({ nullable: true }),
        description: baseString(),
        quantity: numberSchema,
        unit: baseString({ nullable: true }),
        unitCost: numberSchema,
        totalCost: numberSchema,
      },
      required: ['rawLine', 'description'],
    };

    const normalizedSchema: Record<string, unknown> = {
      type: 'OBJECT',
      properties: {
        vendorName: baseString({ nullable: true }),
        vendorAddress: baseString({ nullable: true }),
        billNumber: baseString({ nullable: true }),
        billDate: baseString({ nullable: true }),
        gstRate: numberSchema,
        currency: baseString({ nullable: true }),
        documentType: {
          type: 'STRING',
          enum: ['invoice', 'packing_slip', 'receipt', 'unknown'],
        },
        detectedKeywords: {
          type: 'ARRAY',
          items: baseString(),
        },
        lineItems: {
          type: 'ARRAY',
          items: lineItemSchema,
        },
      },
      required: ['documentType', 'detectedKeywords', 'lineItems'],
    };

    const responseSchema: Record<string, unknown> = {
      type: 'OBJECT',
      properties: {
        normalized: normalizedSchema,
        warnings: {
          type: 'ARRAY',
          items: baseString(),
        },
        notes: {
          type: 'ARRAY',
          items: baseString(),
        },
      },
      required: ['normalized', 'warnings', 'notes'],
    };

    const maxOutputTokens = mode === 'headers_only' ? Math.min(maxTokens, HEADER_ONLY_MAX_OUTPUT_TOKENS) : maxTokens;

    return { responseSchema, maxOutputTokens };
  }
}
