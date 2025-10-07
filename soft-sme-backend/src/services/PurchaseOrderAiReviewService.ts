import dotenv from 'dotenv';
import path from 'path';
import { PurchaseOrderOcrLineItem, PurchaseOrderOcrNormalizedData } from './PurchaseOrderOcrService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface PurchaseOrderAiReviewOptions {
  userId?: number;
}

interface PurchaseOrderAiStructuredResponse {
  normalized: PurchaseOrderOcrNormalizedData;
  warnings: string[];
  notes: string[];
}

const DEFAULT_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

const SYSTEM_INSTRUCTIONS = `You are helping an inventory specialist capture purchase order details.
Extract structured data from raw invoice or packing slip text.
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
  static async reviewRawText(rawText: string, options: PurchaseOrderAiReviewOptions = {}): Promise<PurchaseOrderAiStructuredResponse> {
    const trimmed = rawText?.trim();
    if (!trimmed) {
      throw new Error('Raw text is required for AI review.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const prompt = `${SYSTEM_INSTRUCTIONS}\n\nRAW DOCUMENT:\n${trimmed}`;

    const requestBody = {
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
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
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

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const candidates = this.sortCandidates(data?.candidates);

    if (candidates.length === 0) {
      throw new Error('AI response did not include any candidates.');
    }

    const errors: string[] = [];

    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? [];
      const structuredContent = this.extractStructuredContent(parts);

      if (!structuredContent) {
        const finishReason = candidate?.finishReason ?? 'unknown';
        errors.push(`no structured text (finish reason: ${finishReason})`);
        continue;
      }

      try {
        const structured = this.parseStructuredResponse(structuredContent, options);
        return structured;
      } catch (error) {
        const finishReason = candidate?.finishReason ?? 'unknown';
        const message = error instanceof Error ? error.message : 'unknown error';
        errors.push(`parse failure (finish reason: ${finishReason}): ${message}`);
      }
    }

    throw new Error(`AI response could not be parsed. Attempts: ${errors.join('; ')}`);
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
  ): PurchaseOrderAiStructuredResponse {
    const extractedJson = this.extractJson(responseContent);

    const normalized = this.buildNormalizedData(extractedJson?.normalized ?? {});
    const warnings = this.buildStringArray(extractedJson?.warnings);
    const notes = this.buildStringArray(extractedJson?.notes);

    this.ensureDefaultWarnings(normalized, warnings, notes);

    return {
      normalized,
      warnings,
      notes,
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

  private static cleanJsonText(content: string): string {
    return content
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .replace(/^[\uFEFF\u200B]+/, '')
      .trim();
  }

  private static *generateJsonCandidates(initial: string): Iterable<string> {
    const attempts = new Set<string>();
    const queue: string[] = [initial];

    const applyTransforms = (value: string): string[] => {
      return [
        value,
        this.extractFirstJsonObject(value),
        this.stripTrailingCommas(value),
        this.ensureQuotedKeys(value),
        this.convertSingleQuotedStrings(value),
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

    return items;
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
}

