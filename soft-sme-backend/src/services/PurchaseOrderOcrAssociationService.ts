import { pool } from '../db';
import {
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
  normalized_name: string;
}

interface PartRow {
  part_id: number;
  part_number: string;
  part_description: string | null;
  unit: string | null;
  last_unit_cost: number | null;
  normalized_number: string;
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

    const partWarnings = await this.enrichLineItems(clone);
    partWarnings.forEach((warning) => warnings.add(warning));

    return {
      normalized: clone,
      warnings: Array.from(warnings),
      notes: Array.from(notes),
    };
  }

  private static async enrichVendor(
    normalized: PurchaseOrderOcrNormalizedData,
    rawText: string,
    heuristicNormalized?: PurchaseOrderOcrNormalizedData,
  ): Promise<{ match?: PurchaseOrderOcrVendorMatch; warning?: string; note?: string }> {
    const candidateName = (normalized.vendorName || heuristicNormalized?.vendorName || '').trim();
    if (!candidateName) {
      return {};
    }

    const normalizedName = this.normalizeVendorName(candidateName);
    if (!normalizedName) {
      return {};
    }

    const vendorDetails = this.extractVendorDetails(
      rawText,
      candidateName,
      normalized.vendorAddress || heuristicNormalized?.vendorAddress || null,
    );

    const existingVendor = await this.findVendorByNormalizedName(normalizedName, candidateName);

    if (existingVendor) {
      const match: PurchaseOrderOcrVendorMatch = {
        status: 'existing',
        vendorId: existingVendor.vendor_id,
        vendorName: candidateName,
        matchedVendorName: existingVendor.vendor_name,
        normalizedVendorName: normalizedName,
        confidence: existingVendor.normalized_name === normalizedName ? 1 : 0.75,
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

    const match: PurchaseOrderOcrVendorMatch = {
      status: 'missing',
      vendorId: undefined,
      vendorName: candidateName,
      normalizedVendorName: normalizedName,
      matchedVendorName: null,
      confidence: 0,
      details: vendorDetails,
    };

    const warning = `Vendor "${candidateName}" was not found in the vendor list. Review the captured details and add the vendor if needed.`;

    return { match, warning };
  }

  private static async enrichLineItems(normalized: PurchaseOrderOcrNormalizedData): Promise<string[]> {
    const warnings: string[] = [];

    const items: PurchaseOrderOcrLineItem[] = Array.isArray(normalized.lineItems)
      ? normalized.lineItems
      : [];

    const normalizedNumbers = items
      .map((item) => this.normalizePartNumber(item.partNumber))
      .filter((value): value is string => Boolean(value));

    const uniqueNormalized = Array.from(new Set(normalizedNumbers));

    let partMap = new Map<string, PartRow>();
    if (uniqueNormalized.length > 0) {
      const query = `
        SELECT
          part_id,
          part_number,
          part_description,
          unit,
          last_unit_cost,
          UPPER(regexp_replace(part_number, '[^A-Za-z0-9]', '', 'g')) AS normalized_number
        FROM inventory
        WHERE UPPER(regexp_replace(part_number, '[^A-Za-z0-9]', '', 'g')) = ANY($1::text[])
      `;

      try {
        const result = await pool.query<PartRow>(query, [uniqueNormalized]);
        partMap = new Map(result.rows.map((row) => [row.normalized_number, row]));
      } catch (error) {
        console.error('PurchaseOrderOcrAssociationService: failed to lookup parts', error);
      }
    }

    items.forEach((item) => {
      const normalizedNumber = this.normalizePartNumber(item.partNumber);
      item.normalizedPartNumber = normalizedNumber;

      if (!normalizedNumber) {
        item.match = undefined;
        return;
      }

      const part = partMap.get(normalizedNumber);
      if (part) {
        const descriptionMatches = this.normalizeDescription(item.description)
          === this.normalizeDescription(part.part_description || '');

        const match: PurchaseOrderOcrLineItemMatch = {
          status: 'existing',
          normalizedPartNumber: normalizedNumber,
          matchedPartNumber: part.part_number,
          partId: part.part_id,
          partDescription: part.part_description,
          unit: part.unit,
          lastUnitCost: part.last_unit_cost,
          descriptionMatches,
          suggestedPartNumber: part.part_number,
        };

        item.match = match;

        if (!descriptionMatches) {
          warnings.push(
            `Invoice description for part "${item.partNumber || part.part_number}" does not match inventory description. Confirm whether this should be a new part.`,
          );
        }

        return;
      }

      const match: PurchaseOrderOcrLineItemMatch = {
        status: 'missing',
        normalizedPartNumber: normalizedNumber,
        matchedPartNumber: null,
        partId: undefined,
        partDescription: null,
        unit: item.unit,
        lastUnitCost: item.unitCost,
        descriptionMatches: undefined,
        suggestedPartNumber: this.buildSuggestedPartNumber(item.partNumber, normalizedNumber),
      };

      item.match = match;

      warnings.push(
        `Part "${item.partNumber || normalizedNumber}" is not in the inventory system. Add it before finalizing the purchase order.`,
      );
    });

    return warnings;
  }

  private static normalizeVendorName(name: string | null | undefined): string | null {
    if (!name) {
      return null;
    }
    const normalized = name
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .toUpperCase();
    return normalized || null;
  }

  private static normalizePartNumber(partNumber: string | null | undefined): string | null {
    if (!partNumber) {
      return null;
    }
    const normalized = partNumber
      .normalize('NFKD')
      .replace(/["'\s]/g, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
    return normalized || null;
  }

  private static buildSuggestedPartNumber(original: string | null, normalized: string | null): string | null {
    if (original && original.trim()) {
      return original.trim().toUpperCase();
    }
    return normalized;
  }

  private static normalizeDescription(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private static async findVendorByNormalizedName(normalizedName: string, candidateName: string): Promise<VendorRow | null> {
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
        UPPER(regexp_replace(vendor_name, '[^A-Za-z0-9]', '', 'g')) AS normalized_name
      FROM vendormaster
      WHERE UPPER(regexp_replace(vendor_name, '[^A-Za-z0-9]', '', 'g')) = $1
      LIMIT 1
    `;

    try {
      const exact = await pool.query<VendorRow>(query, [normalizedName]);
      if (exact.rows.length > 0) {
        return exact.rows[0];
      }

      const fuzzyQuery = `
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
          UPPER(regexp_replace(vendor_name, '[^A-Za-z0-9]', '', 'g')) AS normalized_name
        FROM vendormaster
        WHERE vendor_name ILIKE $1
        ORDER BY vendor_name ASC
        LIMIT 1
      `;

      const likePattern = `%${candidateName.replace(/[%_]/g, '').trim()}%`;
      const fuzzy = await pool.query<VendorRow>(fuzzyQuery, [likePattern]);
      return fuzzy.rows[0] ?? null;
    } catch (error) {
      console.error('PurchaseOrderOcrAssociationService: failed to lookup vendor', error);
      return null;
    }
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

