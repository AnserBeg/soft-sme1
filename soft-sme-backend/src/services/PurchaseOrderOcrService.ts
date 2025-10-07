import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface PurchaseOrderOcrLineItem {
  rawLine: string;
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
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
}

export interface PurchaseOrderOcrResponse {
  uploadId: string;
  file: {
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

    this.augmentProcessPath([
      '/opt/render/project/.apt/usr/bin',
      '/opt/render/project/src/.apt/usr/bin',
      '/opt/render/.apt/usr/bin',
    ]);

    const preferredTesseract = options.tesseractCmd || process.env.TESSERACT_CMD || 'tesseract';
    const resolvedTesseract = this.resolveCommand(preferredTesseract, [
      preferredTesseract,
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
    const normalization = this.normalizeText(extraction.text);

    const warnings = [...extraction.warnings, ...normalization.warnings];

    const response: PurchaseOrderOcrResponse = {
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
        normalized: normalization.normalized,
        warnings,
        notes: normalization.notes,
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
          return { text: pdfResult.text, warnings };
        }
        warnings.push('PDF conversion produced no text. Falling back to direct OCR.');
      } catch (error: any) {
        warnings.push(
          'Failed to convert PDF to images for OCR. Ensure pdftoppm is installed on the server. Falling back to direct OCR.'
        );
      }
    }

    const text = await this.runTesseract(filePath);
    return { text, warnings };
  }

  private async extractFromPdf(filePath: string): Promise<TextExtractionResult> {
    const warnings: string[] = [];
    const tempBaseName = `po-ocr-${path.basename(filePath, path.extname(filePath))}-${Date.now()}`;
    const tempDir = os.tmpdir();
    const outputBasePath = path.join(tempDir, tempBaseName);

    try {
      await execFileAsync(this.pdftoppmCmd, ['-png', filePath, outputBasePath]);
    } catch (error: any) {
      if ((error as any)?.code === 'ENOENT') {
        warnings.push(
          'pdftoppm command not found. Install poppler-utils (apk add poppler-utils) to enable PDF OCR support.'
        );
      } else {
        warnings.push('pdftoppm failed to convert PDF.');
      }
      return { text: '', warnings };
    }

    const generatedFiles = await fs.promises.readdir(tempDir);
    const imageFiles = generatedFiles
      .filter((file) => file.startsWith(tempBaseName) && file.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (imageFiles.length === 0) {
      warnings.push('No images were generated from the PDF.');
      return { text: '', warnings };
    }

    const texts: string[] = [];
    for (const imageFile of imageFiles) {
      const imagePath = path.join(tempDir, imageFile);
      try {
        const text = await this.runTesseract(imagePath);
        texts.push(text);
      } finally {
        try {
          await fs.promises.unlink(imagePath);
        } catch (cleanupError) {
          console.warn(`Failed to clean up temporary OCR image ${imagePath}:`, cleanupError);
        }
      }
    }

    return { text: texts.join('\n'), warnings };
  }

  private async runTesseract(filePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.tesseractCmd, [filePath, 'stdout', '--psm', '6', '-l', 'eng'], {
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

  private normalizeText(text: string): NormalizationResult {
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

    const lineItems = this.detectLineItems(lines);
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
    let vendorName: string | null = null;
    let vendorAddress: string | null = null;

    for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
      const line = lines[i];
      if (/(invoice|packing|bill|statement|date|phone|fax|email|ship|sold)/i.test(line)) {
        continue;
      }
      if (line.split(' ').length <= 10) {
        vendorName = line;
        const addressLines: string[] = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
          const addressCandidate = lines[j];
          if (/(invoice|packing|bill|statement|date|phone|fax|email|ship|sold|gst|subtotal|total|amount)/i.test(
            addressCandidate
          )) {
            break;
          }
          if (/^[A-Za-z0-9#.,\-\s]+$/.test(addressCandidate)) {
            addressLines.push(addressCandidate);
          }
        }
        if (addressLines.length > 0) {
          vendorAddress = addressLines.join(', ');
        }
        break;
      }
    }

    return { vendorName, vendorAddress };
  }

  private detectBillNumber(lines: string[]): string | null {
    const billPatterns = [
      /(invoice|bill|packing\s+slip|packing\s+list|reference)\s*(number|no\.?|#)[:\-\s]*([A-Za-z0-9\-\/_]+)/i,
      /(ref\.?|number)[:\-\s]*([A-Za-z0-9\-\/_]+)/i,
    ];

    for (const line of lines) {
      for (const pattern of billPatterns) {
        const match = line.match(pattern);
        if (match) {
          const captured = match[3] || match[2];
          if (captured) {
            return captured.trim();
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

  private detectLineItems(lines: string[]): PurchaseOrderOcrLineItem[] {
    const lineItems: PurchaseOrderOcrLineItem[] = [];
    const headerIndex = lines.findIndex((line) =>
      /(part|item|sku|description).*(qty|quantity).*(price|cost|amount|total)/i.test(line)
    );

    const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;

    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i];
      if (/(subtotal|total|gst|hst|pst|tax)/i.test(line)) {
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
    const sanitized = value.replace(/[^0-9.\-]/g, '');
    if (!sanitized) {
      return null;
    }
    const parsed = parseFloat(sanitized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private async persistResult(file: Express.Multer.File, result: PurchaseOrderOcrResponse): Promise<void> {
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
}
