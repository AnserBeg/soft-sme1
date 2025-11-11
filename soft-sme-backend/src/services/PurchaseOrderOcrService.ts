import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const MONEY_RE = /\$?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
const PART_RE = /[A-Z0-9][A-Z0-9\-_.\/]{1,24}/i;
const UOM_RE =
  /\b(ea|each|pc|pcs|pair|set|pkg|pack|box|bag|roll|sheet|panel|lb|lbs|kg|g|mg|l|liter|litre|ml|cm|mm|m|in|inch|ft\^?2|ft2|sq\s*ft|sqft|square\s*feet|ft|feet|hour|hrs?)\b/i;
const STOP_BEFORE_TOTALS_RE = /(subtotal|total|gst|hst|pst|qst|vat|balance|amount due)/i;
const COMPANY_KEYWORD_RE = /(inc|ltd|limited|llc|company|co\.?|corp|corporation|enterprises|solutions|systems|trading|services)/i;
const EMAIL_RE = /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/i;
const URL_RE = /\b(?:https?:\/\/|www\.)[A-Za-z0-9._\/-?=&%#]+\b/i;

const execFileAsync = promisify(execFile);

interface OcrWord {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrRow {
  words: OcrWord[];
  top: number;
}

export interface PurchaseOrderOcrVendorDetails {
  streetAddress?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactPerson?: string | null;
  telephone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface PurchaseOrderOcrVendorMatch {
  status: 'existing' | 'missing';
  vendorId?: number;
  vendorName: string | null;
  normalizedVendorName: string | null;
  matchedVendorName?: string | null;
  confidence: number;
  details?: PurchaseOrderOcrVendorDetails | null;
}

export interface PurchaseOrderOcrLineItemMatch {
  status: 'existing' | 'missing';
  normalizedPartNumber: string | null;
  matchedPartNumber?: string | null;
  partId?: number;
  partDescription?: string | null;
  unit?: string | null;
  lastUnitCost?: number | null;
  descriptionMatches?: boolean;
  suggestedPartNumber?: string | null;
}

export interface PurchaseOrderOcrLineItem {
  rawLine: string;
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
  normalizedPartNumber?: string | null;
  match?: PurchaseOrderOcrLineItemMatch | null;
}

export interface PurchaseOrderOcrNormalizedData {
  vendorName: string | null;
  vendorAddress: string | null;
  billNumber: string | null;
  billDate: string | null;
  gstRate: number | null;
  currency: string | null;
  documentType: 'invoice' | 'packing_slip' | 'receipt' | 'unknown';
  detectedKeywords: string[];
  lineItems: PurchaseOrderOcrLineItem[];
  vendorMatch?: PurchaseOrderOcrVendorMatch | null;
}

export interface PurchaseOrderOcrResponse {
  source: 'ocr' | 'ai';
  uploadId?: string;
  file?: {
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
    relativePath: string;
  };
  ocr: {
    rawText: string;
    normalized: PurchaseOrderOcrNormalizedData;
    warnings: string[];
    notes: string[];
    processingTimeMs: number;
  };
}

interface TextExtractionResult {
  text: string;
  rows: OcrRow[];
  warnings: string[];
}

interface NormalizationResult {
  normalized: PurchaseOrderOcrNormalizedData;
  warnings: string[];
  notes: string[];
}

interface PurchaseOrderOcrServiceOptions {
  tesseractCmd?: string;
  pdftoppmCmd?: string;
}

export class PurchaseOrderOcrService {
  private readonly uploadDir: string;
  private readonly tesseractCmd: string;
  private readonly pdftoppmCmd: string;

  constructor(uploadDir: string, options: PurchaseOrderOcrServiceOptions = {}) {
    this.uploadDir = uploadDir;

    const localAptRoots = this.computeLocalAptRoots();
    const localAptBinDirs = localAptRoots.map((root) => path.join(root, 'usr', 'bin'));
    const localAptLibDirs = [
      ...localAptRoots.map((root) => path.join(root, 'usr', 'lib')),
      ...localAptRoots.map((root) => path.join(root, 'usr', 'lib', 'x86_64-linux-gnu')),
    ];

    this.augmentProcessPath([
      ...localAptBinDirs,
      '/opt/render/project/.apt/usr/bin',
      '/opt/render/project/src/.apt/usr/bin',
      '/opt/render/.apt/usr/bin',
    ]);

    this.augmentLibraryPath([
      ...localAptLibDirs,
      '/opt/render/project/.apt/usr/lib',
      '/opt/render/project/.apt/usr/lib/x86_64-linux-gnu',
      '/opt/render/project/src/.apt/usr/lib',
      '/opt/render/project/src/.apt/usr/lib/x86_64-linux-gnu',
      '/opt/render/.apt/usr/lib',
      '/opt/render/.apt/usr/lib/x86_64-linux-gnu',
    ]);

    this.ensureTessdataPrefix(localAptRoots);

    const envTesseractBinary = process.env.TESSERACT_CMD || process.env.TESSERACT_PATH;
    const preferredTesseract = options.tesseractCmd || envTesseractBinary || 'tesseract';
    const resolvedTesseract = this.resolveCommand(preferredTesseract, [
      preferredTesseract,
      ...localAptBinDirs.map((dir) => path.join(dir, 'tesseract')),
      '/opt/render/project/.apt/usr/bin/tesseract',
      '/opt/render/project/src/.apt/usr/bin/tesseract',
      '/opt/render/.apt/usr/bin/tesseract',
      '/usr/bin/tesseract',
      '/usr/local/bin/tesseract',
    ]);

    if (resolvedTesseract) {
      this.tesseractCmd = resolvedTesseract;
    } else {
      this.tesseractCmd = preferredTesseract;
      console.warn(
        'PurchaseOrderOcrService: Tesseract command not found in PATH or fallback locations. '
          + 'OCR requests will fail until it is installed.'
      );
    }

    const preferredPdftoppm = options.pdftoppmCmd || process.env.PDFTOPPM_CMD || 'pdftoppm';
    const resolvedPdftoppm = this.resolveCommand(preferredPdftoppm, [
      preferredPdftoppm,
      ...localAptBinDirs.map((dir) => path.join(dir, 'pdftoppm')),
      '/opt/render/project/.apt/usr/bin/pdftoppm',
      '/opt/render/project/src/.apt/usr/bin/pdftoppm',
      '/opt/render/.apt/usr/bin/pdftoppm',
      '/usr/bin/pdftoppm',
      '/usr/local/bin/pdftoppm',
    ]);

    if (resolvedPdftoppm) {
      this.pdftoppmCmd = resolvedPdftoppm;
    } else {
      this.pdftoppmCmd = preferredPdftoppm;
      console.warn(
        'PurchaseOrderOcrService: pdftoppm command not found in PATH or fallback locations. '
          + 'PDF OCR conversion will be unavailable until it is installed.'
      );
    }
  }

  async processDocument(file: Express.Multer.File): Promise<PurchaseOrderOcrResponse> {
    const startTime = Date.now();

    const extraction = await this.extractText(file.path, file.mimetype);
    const normalization = this.normalizeText(extraction.text, extraction.rows);

    const aiModule = await import('./PurchaseOrderAiReviewService');
    const aiResult = await aiModule.PurchaseOrderAiReviewService.reviewRawText(extraction.text, {
      heuristicNormalized: normalization.normalized,
    });

    const warningSet = new Set<string>([
      ...extraction.warnings,
      ...normalization.warnings,
      ...aiResult.warnings,
    ]);
    const warnings = Array.from(warningSet);

    const response: PurchaseOrderOcrResponse = {
      source: 'ai',
      uploadId: crypto.randomUUID(),
      file: {
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        relativePath: path.relative(path.join(__dirname, '..'), file.path),
      },
      ocr: {
        rawText: extraction.text,
        normalized: aiResult.normalized,
        warnings,
        notes: [...normalization.notes, ...aiResult.notes],
        processingTimeMs: Date.now() - startTime,
      },
    };

    try {
      await this.persistResult(file, response);
    } catch (persistError) {
      console.warn('PurchaseOrderOcrService: failed to persist OCR artifact', persistError);
    }

    return response;
  }

  private async extractText(filePath: string, mimeType: string): Promise<TextExtractionResult> {
    const warnings: string[] = [];

    if (mimeType === 'application/pdf') {
      try {
        const pdfResult = await this.extractFromPdf(filePath);
        warnings.push(...pdfResult.warnings);
        if (pdfResult.text.trim().length > 0) {
          return { text: pdfResult.text, rows: pdfResult.rows, warnings };
        }
        warnings.push('PDF conversion produced no text. Falling back to direct OCR.');
      } catch (error: any) {
        warnings.push(
          'Failed to convert PDF to images for OCR. Ensure pdftoppm is installed on the server. Falling back to direct OCR.'
        );
      }
    }

    const direct = await this.performOcr(filePath);
    return { text: direct.text, rows: direct.rows, warnings };
  }

  private async extractFromPdf(filePath: string): Promise<TextExtractionResult> {
    const warnings: string[] = [];
    const tempBaseName = `po-ocr-${path.basename(filePath, path.extname(filePath))}-${Date.now()}`;
    const tempDir = os.tmpdir();
    const outputBasePath = path.join(tempDir, tempBaseName);

    try {
      await execFileAsync(this.pdftoppmCmd, ['-png', '-r', '300', filePath, outputBasePath]);
    } catch (error: any) {
      if ((error as any)?.code === 'ENOENT') {
        warnings.push(
          'pdftoppm command not found. Install poppler-utils (apk add poppler-utils) to enable PDF OCR support.'
        );
      } else {
        warnings.push('pdftoppm failed to convert PDF.');
      }
      return { text: '', rows: [], warnings };
    }

    const generatedFiles = await fs.promises.readdir(tempDir);
    const imageFiles = generatedFiles
      .filter((file) => file.startsWith(tempBaseName) && file.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (imageFiles.length === 0) {
      warnings.push('No images were generated from the PDF.');
      return { text: '', rows: [], warnings };
    }

    const texts: string[] = [];
    const rows: OcrRow[] = [];
    for (const imageFile of imageFiles) {
      const imagePath = path.join(tempDir, imageFile);
      try {
        const result = await this.performOcr(imagePath);
        texts.push(result.text);
        rows.push(...result.rows);
      } finally {
        try {
          await fs.promises.unlink(imagePath);
        } catch (cleanupError) {
          console.warn(`Failed to clean up temporary OCR image ${imagePath}:`, cleanupError);
        }
      }
    }

    return { text: texts.join('\n'), rows, warnings };
  }

  private async performOcr(filePath: string): Promise<{ text: string; rows: OcrRow[] }> {
    const [text, tsv] = await Promise.all([this.runTesseractInternal(filePath, 'plain'), this.runTesseractInternal(filePath, 'tsv')]);
    const rows = this.parseTsv(tsv);
    return { text, rows };
  }

  private async runTesseract(filePath: string): Promise<string> {
    return this.runTesseractInternal(filePath, 'plain');
  }

  private async runTesseractInternal(filePath: string, format: 'plain' | 'tsv'): Promise<string> {
    const args = [filePath, 'stdout', '--psm', '6', '--oem', '1', '-l', 'eng', '-c', 'preserve_interword_spaces=1'] as string[];
    if (format === 'tsv') {
      args.push('tsv');
    }

    try {
      const { stdout } = await execFileAsync(this.tesseractCmd, args, {
        maxBuffer: 1024 * 1024 * 20,
      });
      return stdout;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error(
          `Tesseract binary not found at "${this.tesseractCmd}". Install tesseract-ocr (apk add tesseract-ocr tesseract-ocr-data-eng or apt-get install tesseract-ocr tesseract-ocr-eng) on the server and ensure it is available in PATH.`
        );
      }
      if (error?.stderr) {
        throw new Error(`Tesseract OCR failed: ${String(error.stderr).trim()}`);
      }
      throw new Error('Tesseract OCR failed to process the document.');
    }
  }

  private parseTsv(tsv: string): OcrRow[] {
    if (!tsv || tsv.trim().length === 0) {
      return [];
    }

    const lines = tsv.split(/\r?\n/);
    if (lines.length <= 1) {
      return [];
    }

    const groups = new Map<string, { words: OcrWord[]; top: number }>();

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      const parts = line.split('\t');
      if (parts.length < 12) {
        continue;
      }

      const level = Number(parts[0]);
      if (Number.isNaN(level) || level !== 5) {
        continue;
      }

      const text = (parts[11] || '').trim();
      if (!text) {
        continue;
      }

      const confidence = Number(parts[10]);
      if (Number.isNaN(confidence) || confidence < 0) {
        continue;
      }

      const left = Number(parts[6]);
      const top = Number(parts[7]);
      const width = Number(parts[8]);
      const height = Number(parts[9]);
      if ([left, top, width, height].some((value) => Number.isNaN(value))) {
        continue;
      }

      const key = `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}`;
      const existing = groups.get(key);
      const word: OcrWord = { text, confidence, x: left, y: top, width, height };
      if (existing) {
        existing.top = Math.min(existing.top, top);
        existing.words.push(word);
      } else {
        groups.set(key, { top, words: [word] });
      }
    }

    const rows: OcrRow[] = [];
    for (const group of groups.values()) {
      if (group.words.length === 0) {
        continue;
      }
      group.words.sort((a, b) => a.x - b.x);
      rows.push({
        words: group.words,
        top: group.top,
      });
    }

    rows.sort((a, b) => a.top - b.top);
    return rows;
  }

  private normalizeText(text: string, rows: OcrRow[]): NormalizationResult {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const warnings: string[] = [];
    const notes: string[] = [];

    const detectedKeywords = this.detectKeywords(lines);
    if (detectedKeywords.notes.length > 0) {
      notes.push(...detectedKeywords.notes);
    }

    const vendorInfo = this.detectVendor(lines);
    if (!vendorInfo.vendorName) {
      warnings.push('Vendor name was not confidently detected.');
    }

    const billNumber = this.detectBillNumber(lines);
    if (!billNumber) {
      warnings.push('Bill or invoice number was not detected.');
    }

    const billDate = this.detectBillDate(lines);
    if (!billDate) {
      warnings.push('Bill date was not detected.');
    }

    const gstRate = this.detectGstRate(lines);
    if (gstRate === null) {
      notes.push('GST rate not found. Using existing purchase order default.');
    }

    const currency = this.detectCurrency(lines);

    // --- PATCH: merge wrapped OCR lines ---
    const cleanedLines: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const current = lines[i];
      if (
        i + 1 < lines.length
        && /^[a-z\s.]/.test(lines[i + 1])
        && !/total|gst|subtotal|invoice/i.test(lines[i + 1])
      ) {
        lines[i + 1] = `${current} ${lines[i + 1]}`;
      } else {
        cleanedLines.push(current);
      }
    }

    const lineItems = this.detectLineItems(cleanedLines, rows);
    // --- END PATCH ---
    if (lineItems.length === 0) {
      warnings.push('No line items were detected in the document.');
    }

    const normalized: PurchaseOrderOcrNormalizedData = {
      vendorName: vendorInfo.vendorName,
      vendorAddress: vendorInfo.vendorAddress,
      billNumber,
      billDate,
      gstRate,
      currency,
      documentType: detectedKeywords.type,
      detectedKeywords: detectedKeywords.keywords,
      lineItems,
    };

    // --- PATCH: debug normalized result ---
    console.log('Normalized OCR data:', normalized);
    // --- END PATCH ---

    return { normalized, warnings, notes };
  }

  private detectKeywords(lines: string[]): {
    keywords: string[];
    type: 'invoice' | 'packing_slip' | 'receipt' | 'unknown';
    notes: string[];
  } {
    const keywords: string[] = [];
    let type: 'invoice' | 'packing_slip' | 'receipt' | 'unknown' = 'unknown';
    const joined = lines.join(' ').toLowerCase();

    if (/packing\s+(slip|list)/i.test(joined)) {
      type = 'packing_slip';
      keywords.push('packing slip');
    } else if (/invoice/i.test(joined)) {
      type = 'invoice';
      keywords.push('invoice');
    } else if (/receipt/i.test(joined)) {
      type = 'receipt';
      keywords.push('receipt');
    }

    if (/purchase\s+order/i.test(joined)) {
      keywords.push('purchase order');
    }

    if (/delivery/i.test(joined)) {
      keywords.push('delivery');
    }

    const notes: string[] = [];
    if (type !== 'unknown') {
      notes.push(`Document classified as ${type.replace('_', ' ')} based on keyword detection.`);
    }

    return { keywords, type, notes };
  }

  private detectVendor(lines: string[]): { vendorName: string | null; vendorAddress: string | null } {
    const searchWindow = lines.slice(0, 30);
    const candidates: Array<{ value: string; index: number; score: number }> = [];

    for (let i = 0; i < searchWindow.length; i += 1) {
      const rawLine = searchWindow[i]?.trim();
      if (!rawLine) {
        continue;
      }

      if (
        EMAIL_RE.test(rawLine)
        || URL_RE.test(rawLine)
        || /(bill\s*to|ship\s*to|invoice|packing|statement|date|phone|fax|gst|hst|pst|total|amount|customer)/i.test(rawLine)
      ) {
        continue;
      }

      let score = 0;
      if (COMPANY_KEYWORD_RE.test(rawLine)) {
        score += 3;
      }
      if (/^[A-Z0-9 &'.,\-]+$/.test(rawLine) && rawLine === rawLine.toUpperCase()) {
        score += 2;
      }
      if (/[A-Za-z]/.test(rawLine)) {
        score += 1;
      }
      if (rawLine.split(/\s+/).length <= 6) {
        score += 1;
      }
      if (i < 5) {
        score += 1;
      }
      if (!/[A-Za-z]/.test(rawLine) && /\d/.test(rawLine)) {
        score -= 2;
      }

      if (score > 0) {
        candidates.push({ value: rawLine, index: i, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const topCandidate = candidates[0];
    let vendorName = topCandidate ? topCandidate.value : null;

    if (!vendorName) {
      const fallback = searchWindow.find((line) => line && !EMAIL_RE.test(line) && !URL_RE.test(line));
      vendorName = fallback ?? null;
    }

    // --- PATCH: explicit vendor match ---
    if (!vendorName) {
      const possibleVendor = lines.find((l) => /Parts\s*For\s*Trucks/i.test(l));
      if (possibleVendor) {
        vendorName = 'Parts For Trucks';
      }
    }
    // --- END PATCH ---

    let vendorAddress: string | null = null;
    if (topCandidate) {
      const addressLines: string[] = [];
      for (let j = topCandidate.index + 1; j < Math.min(lines.length, topCandidate.index + 8); j += 1) {
        const candidate = lines[j]?.trim();
        if (!candidate) {
          break;
        }
        if (EMAIL_RE.test(candidate) || URL_RE.test(candidate)) {
          continue;
        }
        if (
          /(invoice|packing|bill|statement|date|gst|hst|pst|total|amount|ship|sold|customer|balance)/i.test(candidate)
        ) {
          break;
        }
        if (/^[A-Za-z0-9#.,\-\s]+$/.test(candidate)) {
          addressLines.push(candidate);
        } else if (addressLines.length > 0) {
          break;
        }
      }
      if (addressLines.length > 0) {
        vendorAddress = addressLines.join(', ');
      }
    }

    return { vendorName, vendorAddress };
  }

  private detectBillNumber(lines: string[]): string | null {
    // --- PATCH: simple Invoice line match ---
    for (const line of lines) {
      const simpleMatch = line.match(/Invoice[:\s#-]+([A-Z0-9\-]+)/i);
      if (simpleMatch) {
        return simpleMatch[1];
      }
    }
    // --- END PATCH ---
    const billPatterns = [
      /(invoice|bill|packing\s+slip|packing\s+list|reference)\s*(number|no\.?|#)[:\-\s]*([A-Za-z0-9\-\/_]+)/i,
      /(invoice|bill)[:\-\s]*([A-Za-z0-9][A-Za-z0-9\-\/_]+)/i,
      /(ref\.?|reference|number)[:\-\s]*([A-Za-z0-9\-\/_]+)/i,
    ];

    for (const line of lines) {
      for (const pattern of billPatterns) {
        const match = line.match(pattern);
        if (match) {
          const captured = match[3] || match[2];
          if (captured) {
            const cleaned = captured.replace(/[^A-Za-z0-9\-\/_]/g, '').trim();
            if (!cleaned) {
              continue;
            }
            const context = match[0];
            if (/total/i.test(context)) {
              continue;
            }
            return cleaned;
          }
        }
      }
    }

    return null;
  }

  private detectBillDate(lines: string[]): string | null {
    const datePatterns = [
      /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/, // YYYY-MM-DD or YYYY/MM/DD
      /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/, // MM/DD/YYYY or DD/MM/YYYY
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[,\s]+(\d{2,4})/i,
    ];

    for (const line of lines) {
      for (const pattern of datePatterns) {
        const match = line.match(pattern);
        if (match) {
          const normalized = this.normalizeDateMatch(match);
          if (normalized) {
            return normalized;
          }
        }
      }
    }

    return null;
  }

  private normalizeDateMatch(match: RegExpMatchArray): string | null {
    if (match.length === 4 && isNaN(Number(match[2]))) {
      const day = parseInt(match[1], 10);
      const month = this.monthNameToNumber(match[2]);
      const year = this.normalizeYear(match[3]);
      if (month !== null && year !== null) {
        return this.formatDate(year, month, day);
      }
      return null;
    }

    if (match.length >= 4) {
      if (match[1].length === 4) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        return this.formatDate(year, month, day);
      }
      const first = parseInt(match[1], 10);
      const second = parseInt(match[2], 10);
      const third = this.normalizeYear(match[3]);
      if (third === null) {
        return null;
      }

      // Heuristic: if value > 12, treat as day
      const month = first > 12 ? second : first;
      const day = first > 12 ? first : second;
      return this.formatDate(third, month, day);
    }

    return null;
  }

  private formatDate(year: number, month: number, day: number): string | null {
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      return null;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString().split('T')[0];
  }

  private monthNameToNumber(month: string): number | null {
    const normalized = month.toLowerCase().slice(0, 3);
    const mapping: Record<string, number> = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    return mapping[normalized] ?? null;
  }

  private normalizeYear(value: string): number | null {
    let year = parseInt(value, 10);
    if (Number.isNaN(year)) {
      return null;
    }
    if (value.length === 2) {
      year += year >= 70 ? 1900 : 2000;
    }
    return year;
  }

  private detectGstRate(lines: string[]): number | null {
    const gstPattern = /(GST|Tax|VAT)\s*(Rate|%)?[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i;
    for (const line of lines) {
      const match = line.match(gstPattern);
      if (match && match[3]) {
        const rate = parseFloat(match[3]);
        if (!Number.isNaN(rate)) {
          return rate;
        }
      }
    }
    return null;
  }

  private detectCurrency(lines: string[]): string | null {
    const joined = lines.join(' ').toUpperCase();
    if (joined.includes(' CAD') || joined.includes('CAD ')) {
      return 'CAD';
    }
    if (joined.includes(' USD') || joined.includes('USD ')) {
      return 'USD';
    }
    if (joined.includes(' EUR') || joined.includes('EUR ')) {
      return 'EUR';
    }
    return null;
  }

  private detectLineItems(lines: string[], rows: OcrRow[]): PurchaseOrderOcrLineItem[] {
    const rowDerived = this.detectLineItemsFromRows(rows);
    if (rowDerived.length > 0) {
      return rowDerived;
    }
    return this.detectLineItemsFromTextLines(lines);
  }

  private detectLineItemsFromRows(rows: OcrRow[]): PurchaseOrderOcrLineItem[] {
    const items: PurchaseOrderOcrLineItem[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const rawLine = row.words.map((word) => word.text).join(' ').trim();
      if (!rawLine) {
        continue;
      }
      if (STOP_BEFORE_TOTALS_RE.test(rawLine)) {
        break;
      }

      const parsed = this.parseRowToLineItem(row);
      if (!parsed) {
        continue;
      }

      const dedupeKey = [
        parsed.partNumber ?? '',
        parsed.description,
        parsed.quantity ?? '',
        parsed.unitCost ?? '',
        parsed.totalCost ?? '',
      ].join('|');
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      items.push({
        rawLine,
        ...parsed,
      });
    }

    return items;
  }

  private parseRowToLineItem(row: OcrRow): Omit<PurchaseOrderOcrLineItem, 'rawLine'> | null {
    if (row.words.length === 0) {
      return null;
    }

    const tokens = row.words
      .map((word) => word.text.trim())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      return null;
    }

    const lowerJoined = tokens.join(' ').toLowerCase();
    if (/(description|qty|quantity|price|total|amount)/i.test(lowerJoined) && !/\d/.test(lowerJoined)) {
      return null;
    }

    let totalCost: number | null = null;
    let totalIndex = -1;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const match = tokens[i].match(MONEY_RE);
      if (match) {
        totalCost = this.tryParseNumber(match[0]);
        totalIndex = i;
        break;
      }
    }

    if (totalCost === null || totalIndex < 0) {
      return null;
    }

    let unitCost: number | null = null;
    let unitIndex = -1;
    for (let i = totalIndex - 1; i >= 0; i -= 1) {
      const match = tokens[i].match(MONEY_RE);
      if (match) {
        unitCost = this.tryParseNumber(match[0]);
        unitIndex = i;
        break;
      }
    }

    let quantity: number | null = null;
    let quantityIndex = -1;
    const searchLimit = unitIndex >= 0 ? unitIndex : totalIndex;
    for (let i = searchLimit - 1; i >= 0; i -= 1) {
      const parsed = this.tryParseNumber(tokens[i]);
      if (parsed !== null) {
        quantity = parsed;
        quantityIndex = i;
        break;
      }
    }

    if (quantity === null && unitCost !== null && totalCost !== null && unitCost !== 0) {
      const derivedQuantity = this.deriveQuantityFromCosts(unitCost, totalCost);
      if (derivedQuantity !== null) {
        quantity = derivedQuantity;
      }
    }

    // --- PATCH: default quantity if EA/unit detected ---
    if (quantity === null && /ea|each|pc|pcs/i.test(tokens.join(' '))) {
      quantity = 1;
    }
    // --- END PATCH ---

    let unit: string | null = null;
    for (const token of tokens) {
      const match = token.match(UOM_RE);
      if (match) {
        const rawUnit = match[0].toLowerCase();
        if (rawUnit === 'ft^2' || rawUnit === 'ft2' || rawUnit === 'sq ft' || rawUnit === 'sqft' || rawUnit === 'square feet') {
          unit = 'ft^2';
        } else {
          unit = rawUnit;
        }
        break;
      }
    }

    let partNumber: string | null = null;
    let partIndex = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.length < 2) {
        continue;
      }
      const match = token.match(PART_RE);
      if (match) {
        partNumber = match[0];
        partIndex = i;
        break;
      }
    }
    // --- PATCH: fallback if not found ---
    if (!partNumber) {
      const maybePart = tokens.find((t) => /^[A-Z0-9]{4,}$/.test(t));
      if (maybePart) {
        partNumber = maybePart;
      }
    }
    // --- END PATCH ---

    const numericIndices = [quantityIndex, unitIndex, totalIndex].filter((idx) => idx >= 0);
    const descriptionEnd = numericIndices.length > 0 ? Math.min(...numericIndices) : tokens.length;
    const descriptionStart = partIndex >= 0 ? partIndex + 1 : 0;

    const descriptionTokens: string[] = [];
    for (let i = descriptionStart; i < descriptionEnd; i += 1) {
      if (i === quantityIndex) {
        continue;
      }
      const token = tokens[i];
      if (MONEY_RE.test(token)) {
        continue;
      }
      descriptionTokens.push(token);
    }

    const description = descriptionTokens.join(' ').replace(/\s+/g, ' ').trim();

    if (!partNumber && description.length < 3) {
      return null;
    }

    return {
      partNumber,
      description,
      quantity,
      unit,
      unitCost,
      totalCost,
    };
  }

  private deriveQuantityFromCosts(unitCost: number, totalCost: number): number | null {
    if (!Number.isFinite(unitCost) || !Number.isFinite(totalCost) || unitCost === 0) {
      return null;
    }

    const ratio = totalCost / unitCost;
    if (!Number.isFinite(ratio)) {
      return null;
    }

    const absRatio = Math.abs(ratio);
    if (absRatio < 0.0001) {
      return null;
    }

    const roundedToTwo = Math.round(absRatio * 100) / 100;
    const roundedToInt = Math.round(absRatio);
    if (Math.abs(absRatio - roundedToInt) <= 0.02) {
      return roundedToInt === 0 ? null : roundedToInt;
    }

    const normalized = parseFloat(roundedToTwo.toFixed(2));
    if (Number.isNaN(normalized) || normalized === 0) {
      return null;
    }

    return normalized;
  }

  private detectLineItemsFromTextLines(lines: string[]): PurchaseOrderOcrLineItem[] {
    const lineItems: PurchaseOrderOcrLineItem[] = [];
    const headerIndex = lines.findIndex((line) =>
      /(part|item|sku|description).*(qty|quantity).*(price|cost|amount|total)/i.test(line)
    );

    const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;

    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i];
      if (STOP_BEFORE_TOTALS_RE.test(line)) {
        break;
      }
      const columns = line.split(/\s{2,}/).map((col) => col.trim()).filter((col) => col.length > 0);
      if (columns.length < 3) {
        continue;
      }

      const maybeQuantity = this.tryParseNumber(columns[columns.length - 3]);
      const maybeUnitCost = this.tryParseNumber(columns[columns.length - 2]);
      const maybeTotal = this.tryParseNumber(columns[columns.length - 1]);

      if (maybeQuantity === null && maybeTotal === null) {
        continue;
      }

      const descriptionParts = columns.slice(0, columns.length - 3);
      let partNumber: string | null = null;
      let description = descriptionParts.join(' ');

      if (descriptionParts.length > 0) {
        const firstToken = descriptionParts[0];
        if (/^[A-Za-z0-9][A-Za-z0-9\-_.]*$/.test(firstToken) && descriptionParts.length > 1) {
          partNumber = firstToken;
          description = descriptionParts.slice(1).join(' ');
        }
      }

      lineItems.push({
        rawLine: line,
        partNumber,
        description: description.trim(),
        quantity: maybeQuantity,
        unit: null,
        unitCost: maybeUnitCost,
        totalCost: maybeTotal,
      });
    }

    return lineItems;
  }

  private tryParseNumber(value: string): number | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let sanitized = '';
    for (const char of trimmed) {
      if (/[0-9.\-]/.test(char)) {
        sanitized += char;
        continue;
      }
      if (char === ',' || char === ' ') {
        continue;
      }
      const mapped = this.mapConfusableDigit(char);
      if (mapped) {
        sanitized += mapped;
      }
    }

    if (!sanitized) {
      const fallback = this.mapSingleCharacterToDigit(trimmed);
      if (fallback) {
        sanitized = fallback;
      }
    }

    if (!sanitized || sanitized === '-' || sanitized === '.') {
      return null;
    }

    const normalized = sanitized
      .replace(/-{2,}/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^-\./, '-0.')
      .replace(/^\./, '0.');

    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private mapConfusableDigit(char: string): string | null {
    if (!char) {
      return null;
    }

    const normalized = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    switch (normalized) {
      case 'O':
      case 'o':
      case 'Ø':
      case 'º':
      case '°':
      case 'D':
      case 'Q':
        return '0';
      case 'I':
      case 'l':
      case 'L':
      case '|':
      case '!':
      case 'ï':
      case 'ì':
        return '1';
      case 'S':
      case 's':
        return '5';
      case 'B':
        return '8';
      case 'G':
        return '6';
      case 'g':
        return '9';
      case 'Z':
      case 'z':
        return '2';
      case '—':
      case '–':
      case '−':
      case '﹘':
      case '﹣':
      case '‑':
        return '-';
      default:
        return null;
    }
  }

  private mapSingleCharacterToDigit(value: string): string | null {
    const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const lower = normalized.toLowerCase();

    if (['o', 'ø', 'º', '°', 'd', 'q'].includes(lower)) {
      return '0';
    }
    if (['i', 'l', '|', '!', 'ï', 'ì', '₁'].includes(lower)) {
      return '1';
    }
    if (lower === 'a') {
      return '1';
    }
    if (lower === 's') {
      return '5';
    }
    if (lower === 'b') {
      return '8';
    }
    if (lower === 'g') {
      return '9';
    }
    if (lower === 'z') {
      return '2';
    }
    if (['—', '–', '−', '﹘', '﹣', '‑', '-'].includes(normalized)) {
      return '-';
    }

    return null;
  }

  private async persistResult(file: Express.Multer.File, result: PurchaseOrderOcrResponse): Promise<void> {
    if (!result.file) {
      return;
    }

    const metadata = {
      ...result,
      file: {
        ...result.file,
        path: file.path,
      },
    };

    const metadataPath = path.join(this.uploadDir, `${file.filename}.json`);
    const textPath = path.join(this.uploadDir, `${file.filename}.txt`);

    await Promise.all([
      fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8'),
      fs.promises.writeFile(textPath, result.ocr.rawText, 'utf-8'),
    ]);
  }

  private resolveCommand(preferred: string, fallbacks: string[]): string | null {
    const candidates = this.normalizeCommandCandidates(preferred, fallbacks);

    for (const candidate of candidates) {
      const resolved = this.isExplicitPath(candidate)
        ? this.checkExplicitPath(candidate)
        : this.findInSystemPath(candidate);

      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  private augmentProcessPath(candidates: string[]): void {
    const currentPath = process.env.PATH || '';
    const segments = currentPath.split(path.delimiter).filter((segment) => segment.length > 0);

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      let stats: fs.Stats | null = null;
      try {
        stats = fs.statSync(candidate);
      } catch {
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      if (segments.includes(candidate)) {
        continue;
      }

      segments.unshift(candidate);
    }

    process.env.PATH = segments.join(path.delimiter);
  }

  private augmentLibraryPath(candidates: string[]): void {
    if (process.platform === 'win32') {
      return;
    }

    const currentLdPath = process.env.LD_LIBRARY_PATH || '';
    const delimiter = ':';
    const segments = currentLdPath
      .split(delimiter)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      let stats: fs.Stats | null = null;
      try {
        stats = fs.statSync(candidate);
      } catch {
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      if (segments.includes(candidate)) {
        continue;
      }

      segments.unshift(candidate);
    }

    if (segments.length > 0) {
      process.env.LD_LIBRARY_PATH = segments.join(delimiter);
    }
  }

  private normalizeCommandCandidates(preferred: string, fallbacks: string[]): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const candidate of [preferred, ...fallbacks]) {
      if (!candidate) {
        continue;
      }
      const key = candidate.trim();
      if (key.length === 0 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(key);
    }
    return candidates;
  }

  private isExplicitPath(command: string): boolean {
    return command.includes('/') || command.includes('\\');
  }

  private checkExplicitPath(commandPath: string): string | null {
    try {
      const stats = fs.statSync(commandPath);
      return stats.isFile() ? commandPath : null;
    } catch {
      return null;
    }
  }

  private findInSystemPath(command: string): string | null {
    const envPath = process.env.PATH || '';
    const pathSegments = envPath.split(path.delimiter).filter((segment) => segment && segment.trim().length > 0);

    const extensions =
      process.platform === 'win32'
        ? (process.env.PATHEXT || '')
            .split(';')
            .map((ext) => ext.trim())
            .filter((ext) => ext.length > 0)
        : [''];

    for (const segment of pathSegments) {
      for (const ext of extensions) {
        const candidatePath = path.join(segment, `${command}${ext}`);
        try {
          const stats = fs.statSync(candidatePath);
          if (stats.isFile()) {
            return candidatePath;
          }
        } catch {
          // Ignore inaccessible or missing files.
        }
      }
    }

    return null;
  }

  private computeLocalAptRoots(): string[] {
    const candidates: Array<string | null> = [
      path.resolve(__dirname, '..', '..', '.apt'),
      path.resolve(__dirname, '..', '..', '..', '.apt'),
      path.resolve(process.cwd(), '.apt'),
      process.env.RENDER_APT_DIR ? path.resolve(process.env.RENDER_APT_DIR) : null,
    ];

    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const normalized = path.normalize(candidate);
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      resolved.push(normalized);
    }

    return resolved;
  }

  private ensureTessdataPrefix(localAptRoots: string[]): void {
    const existing = process.env.TESSDATA_PREFIX;
    if (existing) {
      try {
        if (fs.statSync(existing).isDirectory()) {
          return;
        }
      } catch {
        // Existing value is unusable; fall through to discover a local path.
      }
    }

    const candidateDirs = [
      ...localAptRoots.map((root) => path.join(root, 'usr', 'share', 'tesseract-ocr', '4.00', 'tessdata')),
      ...localAptRoots.map((root) => path.join(root, 'usr', 'share', 'tesseract-ocr', '5', 'tessdata')),
    ];

    for (const candidate of candidateDirs) {
      try {
        if (fs.statSync(candidate).isDirectory()) {
          process.env.TESSDATA_PREFIX = candidate;
          return;
        }
      } catch {
        // Ignore inaccessible paths.
      }
    }
  }
}




