import { pool } from '../db';
import { canonicalizeName, canonicalizePartNumber } from '../lib/normalize';
import { getFuzzyConfig } from '../config';
import { fuzzySearch } from './FuzzySearchService';
import {
  PurchaseOrderOcrIssue,
  PurchaseOrderOcrLineItem,
  PurchaseOrderOcrLineItemMatch,
  PurchaseOrderOcrNormalizedData,
  PurchaseOrderOcrVendorDetails,
  PurchaseOrderOcrVendorMatch,
} from './PurchaseOrderOcrService';

interface AssociationInput {
  normalized: PurchaseOrderOcrNormalizedData;
  rawText: string;
  heuristicNormalized?: PurchaseOrderOcrNormalizedData;
}

interface AssociationResult {
  normalized: PurchaseOrderOcrNormalizedData;
  warnings: string[];
  notes: string[];
  issues: PurchaseOrderOcrIssue[];
}

interface VendorRow {
  vendor_id: number;
  vendor_name: string;
  street_address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postal_code: string | null;
  contact_person: string | null;
  telephone_number: string | null;
  email: string | null;
  website: string | null;
  canonical_name: string | null;
}

interface PartRow {
  part_id: number;
  part_number: string;
  part_description: string | null;
  unit: string | null;
  last_unit_cost: number | null;
  canonical_part_number: string | null;
  canonical_name: string | null;
}

interface PartFuzzyResult {
  part: PartRow | null;
  score: number;
  matches: Array<{ label: string; score: number }>;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)?\d{3}[\s.-]*\d{4}/;
const POSTAL_CODE_RE = /[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d|\b\d{5}(?:-\d{4})?\b/;

export class PurchaseOrderOcrAssociationService {
  static async enrich({ normalized, rawText, heuristicNormalized }: AssociationInput): Promise<AssociationResult> {
    const clone: PurchaseOrderOcrNormalizedData = {
      ...normalized,
      detectedKeywords: Array.isArray(normalized.detectedKeywords)
        ? [...normalized.detectedKeywords]
        : [],
      lineItems: Array.isArray(normalized.lineItems)
        ? normalized.lineItems.map((item) => ({ ...item }))
        : [],
      vendorMatch: normalized.vendorMatch ? { ...normalized.vendorMatch } : undefined,
    };

    const warnings = new Set<string>();
    const notes = new Set<string>();
    const issues: PurchaseOrderOcrIssue[] = [];

    const vendorEnrichment = await this.enrichVendor(
      clone,
      rawText,
      heuristicNormalized,
    );
    if (vendorEnrichment.warning) {
      warnings.add(vendorEnrichment.warning);
    }
    if (vendorEnrichment.note) {
      notes.add(vendorEnrichment.note);
    }
    if (vendorEnrichment.match) {
      clone.vendorMatch = vendorEnrichment.match;
    }
    if (Array.isArray(vendorEnrichment.issues)) {
      vendorEnrichment.issues.forEach((issue) => issues.push(issue));
    }

    const partEnrichment = await this.enrichLineItemsWithIssues(clone);
    partEnrichment.warnings.forEach((warning) => warnings.add(warning));
    partEnrichment.notes.forEach((note) => notes.add(note));
    partEnrichment.issues.forEach((issue) => issues.push(issue));

    return {
      normalized: clone,
      warnings: Array.from(warnings),
      notes: Array.from(notes),
      issues,
    };
  }

  private static async enrichVendor(
    normalized: PurchaseOrderOcrNormalizedData,
    rawText: string,
    heuristicNormalized?: PurchaseOrderOcrNormalizedData,
  ): Promise<{ match?: PurchaseOrderOcrVendorMatch; warning?: string; note?: string; issues?: PurchaseOrderOcrIssue[] }> {
    const candidateName = (normalized.vendorName || heuristicNormalized?.vendorName || '').trim();
    if (!candidateName) {
      return {};
    }

    const canonicalName = this.canonicalizeVendorName(candidateName);
    if (!canonicalName) {
      return {};
    }

    const vendorDetails = this.extractVendorDetails(
      rawText,
      candidateName,
      normalized.vendorAddress || heuristicNormalized?.vendorAddress || null,
    );

    const existingVendor = await this.findVendorByCanonicalName(canonicalName);

    if (existingVendor) {
      const match: PurchaseOrderOcrVendorMatch = {
        status: 'existing',
        vendorId: existingVendor.vendor_id,
        vendorName: candidateName,
        matchedVendorName: existingVendor.vendor_name,
        normalizedVendorName: canonicalName,
        confidence: 1,
        details: {
          streetAddress: existingVendor.street_address,
          city: existingVendor.city,
          province: existingVendor.province,
          country: existingVendor.country,
          postalCode: existingVendor.postal_code,
          contactPerson: existingVendor.contact_person,
          telephone: existingVendor.telephone_number,
          email: existingVendor.email,
          website: existingVendor.website,
        },
      };

      return {
        match,
        note: `Matched invoice vendor to existing vendor "${existingVendor.vendor_name}" automatically.`,
      };
    }

    const fuzzyVendor = await this.findVendorByFuzzy(candidateName);
    if (fuzzyVendor?.vendor) {
      const { vendor, score } = fuzzyVendor;
      const match: PurchaseOrderOcrVendorMatch = {
        status: 'existing',
        vendorId: vendor.vendor_id,
        vendorName: candidateName,
        matchedVendorName: vendor.vendor_name,
        normalizedVendorName: canonicalName,
        confidence: score,
        details: {
          streetAddress: vendor.street_address,
          city: vendor.city,
          province: vendor.province,
          country: vendor.country,
          postalCode: vendor.postal_code,
          contactPerson: vendor.contact_person,
          telephone: vendor.telephone_number,
          email: vendor.email,
          website: vendor.website,
        },
      };

      const confidenceText = Number.isFinite(score)
        ? ` (confidence ${(score * 100).toFixed(0)}%)`
        : '';

      const issue: PurchaseOrderOcrIssue = {
        id: `vendor_fuzzy_match:${vendor.vendor_id}`,
        type: 'vendor_fuzzy_match',
        severity: 'warning',
        message: `Fuzzy matched invoice vendor "${candidateName}" to existing vendor "${vendor.vendor_name}"${confidenceText}.`,
        vendorId: vendor.vendor_id,
        suggestedVendorIds: [vendor.vendor_id],
      };

      return {
        match,
        note: `Fuzzy matched invoice vendor to existing vendor "${vendor.vendor_name}"${confidenceText}.`,
        issues: [issue],
      };
    }

    const match: PurchaseOrderOcrVendorMatch = {
      status: 'missing',
      vendorId: undefined,
      vendorName: candidateName,
      normalizedVendorName: canonicalName,
      matchedVendorName: null,
      confidence: 0,
      details: vendorDetails,
    };

    let warning = `Vendor "${candidateName}" was not found in the vendor list. Review the captured details and add the vendor if needed.`;

    const { minScoreShow } = getFuzzyConfig();

    if (fuzzyVendor && fuzzyVendor.matches.length > 0 && fuzzyVendor.score >= minScoreShow) {
      const suggestions = this.formatFuzzySuggestions(fuzzyVendor.matches);
      if (suggestions) {
        warning += ` Potential matches: ${suggestions}.`;
      }
    }

    const issue: PurchaseOrderOcrIssue = {
      id: `vendor_missing:${canonicalName}`,
      type: 'vendor_missing',
      severity: 'error',
      message: warning,
      vendorId: undefined,
      suggestedVendorIds: (fuzzyVendor?.matches || [])
        .map((entry: any) => (entry as any).id)
        .filter((id: any) => Number.isFinite(id)),
    };

    return { match, warning, issues: [issue] };
  }

  private static async enrichLineItems(
    normalized: PurchaseOrderOcrNormalizedData,
  ): Promise<{ warnings: string[]; notes: string[] }> {
    const warnings: string[] = [];
    const notes: string[] = [];

    const items: PurchaseOrderOcrLineItem[] = Array.isArray(normalized.lineItems)
      ? normalized.lineItems
      : [];

    const { minScoreAuto, minScoreShow } = getFuzzyConfig();

    const canonicalNumbers = items
      .map((item) => this.canonicalizePartNumberValue(item.partNumber))
      .filter((value): value is string => Boolean(value));

    const uniqueCanonicalNumbers = Array.from(new Set(canonicalNumbers));

    let partMap = new Map<string, PartRow>();
    if (uniqueCanonicalNumbers.length > 0) {
      try {
        const result = await this.findPartsByCanonicalNumbers(uniqueCanonicalNumbers);
        partMap = new Map(
          result.map((row) => {
            const canonical = row.canonical_part_number || this.canonicalizePartNumberValue(row.part_number) || '';
            return [canonical, row];
          }),
        );
      } catch (error) {
        console.error('PurchaseOrderOcrAssociationService: failed to lookup parts', error);
      }
    }

    const fuzzyCache = new Map<string, PartFuzzyResult>();

    for (const item of items) {
      const canonicalNumber = this.canonicalizePartNumberValue(item.partNumber);
      item.normalizedPartNumber = canonicalNumber;

      if (!canonicalNumber) {
        item.match = undefined;
        continue;
      }

      let part = partMap.get(canonicalNumber);
      let matchedViaFuzzy = false;
      let fuzzyScore: number | null = null;
      let fuzzyResult: PartFuzzyResult | null = null;

      if (!part) {
        fuzzyResult = await this.findPartByFuzzy(canonicalNumber, item.partNumber, fuzzyCache);
        if (fuzzyResult?.part && fuzzyResult.score >= minScoreAuto) {
          part = fuzzyResult.part;
          matchedViaFuzzy = true;
          fuzzyScore = fuzzyResult.score;
          if (part.canonical_part_number) {
            partMap.set(part.canonical_part_number, part);
          }
        } else if (fuzzyResult && fuzzyResult.matches.length > 0 && fuzzyResult.score >= minScoreShow) {
          const suggestions = this.formatFuzzySuggestions(fuzzyResult.matches);
          if (suggestions) {
            warnings.push(
              `Part "${item.partNumber || canonicalNumber}" was not matched exactly. Possible matches: ${suggestions}.`,
            );
          }
        }
      }

      if (part) {
        const descriptionMatches =
          this.canonicalizeDescription(item.description) ===
          this.canonicalizeDescription(part.part_description || '');

        const match: PurchaseOrderOcrLineItemMatch = {
          status: 'existing',
          normalizedPartNumber: canonicalNumber,
          matchedPartNumber: part.part_number,
          partId: part.part_id,
          partDescription: part.part_description,
          unit: part.unit,
          lastUnitCost: part.last_unit_cost,
          descriptionMatches,
          suggestedPartNumber: part.part_number,
        };

        item.match = match;

        if (matchedViaFuzzy && Number.isFinite(fuzzyScore)) {
          notes.push(
            `Fuzzy matched part "${item.partNumber || canonicalNumber}" to inventory part "${part.part_number}" (confidence ${(fuzzyScore! * 100).toFixed(0)}%).`,
          );
        }

        if (!descriptionMatches) {
          warnings.push(
            `Invoice description for part "${item.partNumber || part.part_number}" does not match inventory description. Confirm whether this should be a new part.`,
          );
        }

        continue;
      }

      const match: PurchaseOrderOcrLineItemMatch = {
        status: 'missing',
        normalizedPartNumber: canonicalNumber,
        matchedPartNumber: null,
        partId: undefined,
        partDescription: null,
        unit: item.unit,
        lastUnitCost: item.unitCost,
        descriptionMatches: undefined,
        suggestedPartNumber: this.buildSuggestedPartNumber(item.partNumber, canonicalNumber),
      };

      item.match = match;

      warnings.push(
        `Part "${item.partNumber || canonicalNumber}" is not in the inventory system. Add it before finalizing the purchase order.`,
      );
    }

    return { warnings, notes };
  }

  private static async enrichLineItemsWithIssues(
    normalized: PurchaseOrderOcrNormalizedData,
  ): Promise<{ warnings: string[]; notes: string[]; issues: PurchaseOrderOcrIssue[] }> {
    const base = await this.enrichLineItems(normalized);
    const issues: PurchaseOrderOcrIssue[] = [];

    const items: PurchaseOrderOcrLineItem[] = Array.isArray(normalized.lineItems)
      ? normalized.lineItems
      : [];

    items.forEach((item, index) => {
      const match = item.match;
      if (!match) {
        return;
      }

      if (match.status === 'missing') {
        issues.push({
          id: `part_missing:${item.normalizedPartNumber || ''}:${index}`,
          type: 'part_missing',
          severity: 'error',
          message: `Part "${item.partNumber || item.normalizedPartNumber || ''}" is not in the inventory system. Add it before finalizing the purchase order.`,
          lineItemIndex: index,
          partId: null,
        });
      } else if (match.status === 'existing' && match.descriptionMatches === false) {
        issues.push({
          id: `description_mismatch:${item.normalizedPartNumber || ''}:${index}`,
          type: 'description_mismatch',
          severity: 'warning',
          message: `Invoice description for part "${item.partNumber || match.matchedPartNumber || ''}" does not match inventory description. Confirm whether this should be a new part.`,
          lineItemIndex: index,
          partId: match.partId,
        });
      }
    });

    return { warnings: base.warnings, notes: base.notes, issues };
  }

  private static buildSuggestedPartNumber(original: string | null, normalized: string | null): string | null {
    if (original && original.trim()) {
      return original.trim().toUpperCase();
    }
    return normalized;
  }

  private static canonicalizeVendorName(value: string | null | undefined): string | null {
    const canonical = canonicalizeName(value ?? '');
    return canonical || null;
  }

  private static canonicalizePartNumberValue(value: string | null | undefined): string | null {
    const canonical = canonicalizePartNumber(value ?? '');
    return canonical || null;
  }

  private static canonicalizeDescription(value: string | null | undefined): string {
    return canonicalizeName(value ?? '') || '';
  }

  private static formatFuzzySuggestions(matches: Array<{ label: string; score: number }>): string {
    const suggestions = matches
      .filter((match) => Boolean(match?.label))
      .slice(0, 3)
      .map((match) => {
        const label = typeof match.label === 'string' ? match.label : String(match.label ?? '');
        if (!label.trim()) {
          return '';
        }
        const score = Number.isFinite(match.score) ? Math.round(match.score * 100) : null;
        return score !== null ? `${label} (${score}%)` : label;
      })
      .filter((entry) => entry.trim().length > 0);

    return suggestions.join(', ');
  }

  private static async findVendorByCanonicalName(canonicalName: string): Promise<VendorRow | null> {
    const query = `
      SELECT
        vendor_id,
        vendor_name,
        street_address,
        city,
        province,
        country,
        postal_code,
        contact_person,
        telephone_number,
        email,
        website,
        canonical_name
      FROM vendormaster
      WHERE canonical_name = $1
      LIMIT 1
    `;

    try {
      const result = await pool.query<VendorRow>(query, [canonicalName]);
      return result.rows[0] ?? null;
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: failed to lookup vendor by canonical name', error);
      return null;
    }
  }

  private static async findVendorById(id: number): Promise<VendorRow | null> {
    const query = `
      SELECT
        vendor_id,
        vendor_name,
        street_address,
        city,
        province,
        country,
        postal_code,
        contact_person,
        telephone_number,
        email,
        website,
        canonical_name
      FROM vendormaster
      WHERE vendor_id = $1
      LIMIT 1
    `;

    try {
      const result = await pool.query<VendorRow>(query, [id]);
      return result.rows[0] ?? null;
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: failed to lookup vendor by id', error);
      return null;
    }
  }

  private static async findVendorByFuzzy(
    candidateName: string,
  ): Promise<{ vendor: VendorRow | null; score: number; matches: Array<{ label: string; score: number }> } | null> {
    const trimmed = candidateName.trim();
    if (!trimmed) {
      return null;
    }

    const { minScoreAuto, maxResults } = getFuzzyConfig();
    let matches: Awaited<ReturnType<typeof fuzzySearch>> = [];
    try {
      matches = await fuzzySearch({ type: 'vendor', query: trimmed, limit: maxResults });
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: fuzzy vendor search failed', error);
      return null;
    }

    if (!matches.length) {
      return { vendor: null, score: 0, matches: [] };
    }

    const sanitized = matches.map((match) => {
      const label = typeof match.label === 'string' ? match.label : String(match.label ?? match.id);
      const score = Number.isFinite(match.score) ? match.score : 0;
      return { id: match.id, label, score };
    });

    const top = sanitized[0];
    const topScore = top ? top.score : 0;

    if (top && topScore >= minScoreAuto) {
      const vendor = await this.findVendorById(top.id);
      if (vendor) {
        return {
          vendor,
          score: topScore,
          matches: sanitized.map(({ label, score }) => ({ label, score })),
        };
      }
    }

    return {
      vendor: null,
      score: topScore,
      matches: sanitized.map(({ label, score }) => ({ label, score })),
    };
  }

  private static async findPartsByCanonicalNumbers(canonicalNumbers: string[]): Promise<PartRow[]> {
    const query = `
      SELECT
        part_id,
        part_number,
        part_description,
        unit,
        last_unit_cost,
        canonical_part_number,
        canonical_name
      FROM inventory
      WHERE canonical_part_number = ANY($1::text[])
    `;

    const result = await pool.query<PartRow>(query, [canonicalNumbers]);
    return result.rows;
  }

  private static async findPartById(id: number): Promise<PartRow | null> {
    const query = `
      SELECT
        part_id,
        part_number,
        part_description,
        unit,
        last_unit_cost,
        canonical_part_number,
        canonical_name
      FROM inventory
      WHERE part_id = $1
      LIMIT 1
    `;

    try {
      const result = await pool.query<PartRow>(query, [id]);
      return result.rows[0] ?? null;
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: failed to lookup part by id', error);
      return null;
    }
  }

  private static async findPartByFuzzy(
    canonicalNumber: string,
    originalValue: string | null | undefined,
    cache: Map<string, PartFuzzyResult>,
  ): Promise<PartFuzzyResult | null> {
    const key = canonicalNumber;
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    const queryValue =
      originalValue && originalValue.trim()
        ? originalValue.trim()
        : canonicalNumber;

    const canonicalQuery = this.canonicalizePartNumberValue(queryValue) || canonicalNumber;

    const { minScoreAuto, maxResults } = getFuzzyConfig();
    let matches: Awaited<ReturnType<typeof fuzzySearch>> = [];
    try {
      matches = await fuzzySearch({ type: 'part', query: canonicalQuery, limit: maxResults });
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: fuzzy part search failed', error);
      const fallback: PartFuzzyResult = { part: null, score: 0, matches: [] };
      cache.set(key, fallback);
      return fallback;
    }

    if (!matches.length) {
      const empty: PartFuzzyResult = { part: null, score: 0, matches: [] };
      cache.set(key, empty);
      return empty;
    }

    const sanitized = matches.map((match) => {
      const label = typeof match.label === 'string' ? match.label : String(match.label ?? match.id);
      const score = Number.isFinite(match.score) ? match.score : 0;
      return { id: match.id, label, score };
    });

    // Require canonical equality to avoid cross-digit/letter matches
    const canonicalMatches = sanitized.filter((match) => {
      const canonicalLabel = this.canonicalizePartNumberValue(match.label) || '';
      return canonicalLabel === canonicalNumber;
    });

    if (!canonicalMatches.length) {
      const empty: PartFuzzyResult = {
        part: null,
        score: 0,
        matches: sanitized.map(({ label, score }) => ({ label, score })),
      };
      cache.set(key, empty);
      return empty;
    }

    const top = canonicalMatches[0];
    const topScore = top ? top.score : 0;

    let part: PartRow | null = null;
    if (top && topScore >= minScoreAuto) {
      part = await this.findPartById(top.id);
    }

    const result: PartFuzzyResult = {
      part,
      score: topScore,
      matches: sanitized.map(({ label, score }) => ({ label, score })),
    };

    cache.set(key, result);
    return result;
  }

  private static extractVendorDetails(
    rawText: string,
    candidateName: string,
    addressCandidate: string | null,
  ): PurchaseOrderOcrVendorDetails {
    const details: PurchaseOrderOcrVendorDetails = {};

    if (addressCandidate) {
      const parsed = this.parseAddress(addressCandidate);
      Object.assign(details, parsed);
    }

    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const lowerName = candidateName.trim().toLowerCase();
    let anchorIndex = lines.findIndex((line) => line.toLowerCase().includes(lowerName));
    if (anchorIndex === -1) {
      anchorIndex = 0;
    }

    const start = Math.max(0, anchorIndex - 2);
    const end = Math.min(lines.length, anchorIndex + 10);

    for (let i = start; i < end; i += 1) {
      const line = lines[i];
      if (!details.email) {
        const emailMatch = line.match(EMAIL_RE);
        if (emailMatch) {
          details.email = emailMatch[0];
        }
      }

      if (!details.telephone) {
        const phoneMatch = line.match(PHONE_RE);
        if (phoneMatch) {
          details.telephone = phoneMatch[0];
        }
      }

      if (!details.postalCode) {
        const postalMatch = line.match(POSTAL_CODE_RE);
        if (postalMatch) {
          details.postalCode = postalMatch[0];
        }
      }

      if (!details.streetAddress && /\d/.test(line) && !EMAIL_RE.test(line)) {
        details.streetAddress = details.streetAddress
          ? `${details.streetAddress}, ${line}`
          : line;
      }
    }

    if (!details.streetAddress && addressCandidate) {
      details.streetAddress = addressCandidate;
    }

    return details;
  }

  private static parseAddress(value: string): PurchaseOrderOcrVendorDetails {
    const details: PurchaseOrderOcrVendorDetails = {};
    if (!value) {
      return details;
    }

    const parts = value
      .split(/,|\n/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (parts.length === 0) {
      return details;
    }

    details.streetAddress = parts[0] || null;

    if (parts.length >= 2) {
      details.city = parts[1] || null;
    }

    if (parts.length >= 3) {
      const maybeProvince = parts[2];
      if (POSTAL_CODE_RE.test(maybeProvince)) {
        details.postalCode = maybeProvince.match(POSTAL_CODE_RE)?.[0] || null;
      } else {
        details.province = maybeProvince;
      }
    }

    if (parts.length >= 4) {
      const maybePostal = parts[3];
      if (POSTAL_CODE_RE.test(maybePostal)) {
        details.postalCode = maybePostal.match(POSTAL_CODE_RE)?.[0] || details.postalCode || null;
      } else if (!details.country) {
        details.country = maybePostal;
      }
    }

    if (parts.length >= 5 && !details.country) {
      details.country = parts[4];
    }

    return details;
  }
}

