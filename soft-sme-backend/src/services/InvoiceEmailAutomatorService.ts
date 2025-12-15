import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import { AgentEmailService } from './agentEmail/service';
import { PurchaseOrderOcrService } from './PurchaseOrderOcrService';
import { PurchaseOrderService } from './PurchaseOrderService';

type SyncOptions = {
  query?: string;
  maxMessages?: number;
  autoCreatePurchaseOrders?: boolean;
};

type IngestionRow = {
  id: number;
  user_id: number;
  provider: string;
  message_uid: string;
  message_id: string | null;
  subject: string | null;
  from_address: string | null;
  received_at: string | null;
  attachment_id: string;
  attachment_filename: string | null;
  attachment_content_type: string | null;
  attachment_size: number | null;
  status: string;
  purchase_id: number | null;
  ocr_upload_id: string | null;
  ocr_raw_text: string | null;
  ocr_normalized: any;
  ocr_warnings: any;
  ocr_notes: any;
  ocr_issues: any;
  error: string | null;
  created_at: string;
};

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/bmp',
  'image/gif',
  'image/webp',
]);

export class InvoiceEmailAutomatorService {
  private readonly agentEmailService: AgentEmailService;
  private readonly ocrService: PurchaseOrderOcrService;
  private readonly purchaseOrderService: PurchaseOrderService;
  private readonly uploadDir: string;

  constructor(private readonly pool: Pool, uploadDir: string) {
    this.agentEmailService = new AgentEmailService(pool);
    this.ocrService = new PurchaseOrderOcrService(uploadDir);
    this.purchaseOrderService = new PurchaseOrderService(pool);
    this.uploadDir = uploadDir;

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async listIngestions(userId: number, limit = 50): Promise<IngestionRow[]> {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 200) : 50;
    const result = await this.pool.query(
      `SELECT *
         FROM invoice_email_ingestions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, safeLimit]
    );
    return result.rows;
  }

  async getIngestion(userId: number, id: number): Promise<IngestionRow | null> {
    const result = await this.pool.query(
      `SELECT *
         FROM invoice_email_ingestions
        WHERE user_id = $1 AND id = $2
        LIMIT 1`,
      [userId, id]
    );
    return result.rowCount ? result.rows[0] : null;
  }

  private async ensureIngestionRecord(params: {
    userId: number;
    provider: string;
    messageUid: string;
    messageId?: string | null;
    subject?: string | null;
    fromAddress?: string | null;
    receivedAt?: string | null;
    attachmentId: string;
    attachmentFilename?: string | null;
    attachmentContentType?: string | null;
    attachmentSize?: number | null;
  }): Promise<IngestionRow> {
    const {
      userId,
      provider,
      messageUid,
      attachmentId,
      messageId,
      subject,
      fromAddress,
      receivedAt,
      attachmentFilename,
      attachmentContentType,
      attachmentSize,
    } = params;

    const existing = await this.pool.query(
      `SELECT *
         FROM invoice_email_ingestions
        WHERE user_id = $1 AND provider = $2 AND message_uid = $3 AND attachment_id = $4
        LIMIT 1`,
      [userId, provider, messageUid, attachmentId]
    );

    if (existing.rowCount) {
      return existing.rows[0];
    }

    const inserted = await this.pool.query(
      `INSERT INTO invoice_email_ingestions (
          user_id, provider, message_uid, message_id, subject, from_address, received_at,
          attachment_id, attachment_filename, attachment_content_type, attachment_size,
          status
       ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          'processing'
       )
       RETURNING *`,
      [
        userId,
        provider,
        messageUid,
        messageId ?? null,
        subject ?? null,
        fromAddress ?? null,
        receivedAt ? new Date(receivedAt).toISOString() : null,
        attachmentId,
        attachmentFilename ?? null,
        attachmentContentType ?? null,
        attachmentSize ?? null,
      ]
    );

    return inserted.rows[0];
  }

  private async updateIngestion(id: number, patch: Partial<IngestionRow>): Promise<void> {
    const columns: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const set = (key: string, value: any) => {
      columns.push(`${key} = $${idx}`);
      values.push(value);
      idx += 1;
    };

    if (patch.status !== undefined) set('status', patch.status);
    if (patch.purchase_id !== undefined) set('purchase_id', patch.purchase_id);
    if (patch.ocr_upload_id !== undefined) set('ocr_upload_id', patch.ocr_upload_id);
    if (patch.ocr_raw_text !== undefined) set('ocr_raw_text', patch.ocr_raw_text);
    if (patch.ocr_normalized !== undefined) set('ocr_normalized', patch.ocr_normalized);
    if (patch.ocr_warnings !== undefined) set('ocr_warnings', patch.ocr_warnings);
    if (patch.ocr_notes !== undefined) set('ocr_notes', patch.ocr_notes);
    if (patch.ocr_issues !== undefined) set('ocr_issues', patch.ocr_issues);
    if (patch.error !== undefined) set('error', patch.error);

    if (columns.length === 0) return;

    values.push(id);
    await this.pool.query(`UPDATE invoice_email_ingestions SET ${columns.join(', ')} WHERE id = $${idx}`, values);
  }

  private async createTempFileFromAttachment(params: {
    filename: string;
    mimeType: string;
    contentBase64: string;
  }): Promise<{ filePath: string; storedName: string; size: number }> {
    const buffer = Buffer.from(params.contentBase64, 'base64');
    const sanitizedOriginal = params.filename.replace(/[^A-Za-z0-9.\-]/g, '_');
    const extension = path.extname(sanitizedOriginal) || '';
    const baseName = path.basename(sanitizedOriginal, extension).slice(0, 50) || 'document';
    const storedName = `${Date.now()}-${crypto.randomUUID()}-${baseName}${extension}`;
    const filePath = path.join(this.uploadDir, storedName);
    await fs.promises.writeFile(filePath, buffer);
    return { filePath, storedName, size: buffer.byteLength };
  }

  async syncTitanMailbox(userId: number, options: SyncOptions = {}) {
    const defaultInvoiceKeywords = [
      'invoice',
      'inv',
      'bill',
      'billing',
      'receipt',
      'facture',
      '"tax invoice"',
      '"commercial invoice"',
      '"amount due"',
    ];

    const rawQuery = (options.query || '').trim();
    const baseQuery = rawQuery.length > 0 ? rawQuery : 'unread:true has:attachment';

    const ensureHasAttachment = (value: string) =>
      /\bhas:attachment\b/i.test(value) ? value : `${value} has:attachment`;

    const ensureSomeInvoiceKeyword = (value: string) => {
      const lower = value.toLowerCase();
      const hasSomeInvoiceWord = defaultInvoiceKeywords.some((kw) => {
        const normalized = kw.replace(/"/g, '').toLowerCase();
        return lower.includes(normalized);
      });

      if (hasSomeInvoiceWord) {
        return value;
      }

      // Search in subject for invoice-related keywords by default.
      return `${value} ${defaultInvoiceKeywords.map((kw) => `subject:${kw}`).join(' ')}`.trim();
    };

    const query = ensureSomeInvoiceKeyword(ensureHasAttachment(baseQuery)).trim();
    const maxMessages = Number.isFinite(options.maxMessages as number)
      ? Math.min(Math.max(Number(options.maxMessages), 1), 50)
      : 20;
    const autoCreatePurchaseOrders = options.autoCreatePurchaseOrders !== false;

    const messages = await this.agentEmailService.emailSearch(userId, query, maxMessages);

    let scannedMessages = 0;
    let processedAttachments = 0;
    let createdPurchaseOrders = 0;
    let needsReview = 0;
    let skipped = 0;
    let errors = 0;

    const ingestions: IngestionRow[] = [];

    for (const summary of messages) {
      scannedMessages += 1;

      let detail;
      try {
        detail = await this.agentEmailService.emailRead(userId, summary.id);
      } catch (error) {
        errors += 1;
        continue;
      }

      const subjectLower = (detail.subject || '').toLowerCase();
      const rejectStatementTerms = [
        'statement',
        'statement of account',
        'monthly statement',
        'account statement',
        'soa',
      ];
      if (rejectStatementTerms.some((term) => subjectLower.includes(term))) {
        skipped += 1;
        continue;
      }

      for (const attachment of detail.attachments || []) {
        const contentType = attachment.contentType || 'application/octet-stream';
        if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(contentType)) {
          skipped += 1;
          continue;
        }

        let ingestion = await this.ensureIngestionRecord({
          userId,
          provider: 'titan',
          messageUid: detail.id,
          messageId: detail.messageId,
          subject: detail.subject,
          fromAddress: detail.from?.address,
          receivedAt: detail.date,
          attachmentId: attachment.id,
          attachmentFilename: attachment.filename,
          attachmentContentType: contentType,
          attachmentSize: attachment.size,
        });

        if (ingestion.status === 'created_po' || ingestion.status === 'needs_review' || ingestion.status === 'processed') {
          ingestions.push(ingestion);
          skipped += 1;
          continue;
        }

        try {
          const attachmentContent = await this.agentEmailService.emailGetAttachment(
            userId,
            detail.id,
            attachment.id
          );

          const temp = await this.createTempFileFromAttachment({
            filename: attachmentContent.filename,
            mimeType: attachmentContent.contentType,
            contentBase64: attachmentContent.contentBase64,
          });

          const fakeMulterFile: any = {
            originalname: attachmentContent.filename,
            mimetype: attachmentContent.contentType,
            size: temp.size,
            filename: temp.storedName,
            path: temp.filePath,
          };

          const ocrResult = await this.ocrService.processDocument(fakeMulterFile);

          const normalized = ocrResult.ocr.normalized as any;
          const vendorMatch = normalized?.vendorMatch;
          const isInvoice = normalized?.documentType === 'invoice';
          const rawTextLower = (ocrResult.ocr.rawText || '').toLowerCase();
          const keywordTokens: string[] = Array.isArray(normalized?.detectedKeywords)
            ? normalized.detectedKeywords.map((k: any) => String(k).toLowerCase())
            : [];
          const looksLikeStatement =
            !isInvoice
            || keywordTokens.some((k) => k.includes('statement'))
            || /\bstatement of account\b/i.test(rawTextLower)
            || /\baccount statement\b/i.test(rawTextLower)
            || /\bmonthly statement\b/i.test(rawTextLower)
            || /\bsoa\b/i.test(rawTextLower);
          const vendorId = vendorMatch?.status === 'existing' ? Number(vendorMatch?.vendorId) : NaN;

          await this.updateIngestion(ingestion.id, {
            status: 'processed',
            ocr_upload_id: ocrResult.uploadId ?? null,
            ocr_raw_text: ocrResult.ocr.rawText,
            ocr_normalized: ocrResult.ocr.normalized as any,
            ocr_warnings: ocrResult.ocr.warnings as any,
            ocr_notes: ocrResult.ocr.notes as any,
            ocr_issues: (ocrResult.ocr as any).issues ?? null,
            error: null,
          });

          ingestion = (await this.getIngestion(userId, ingestion.id)) ?? ingestion;
          processedAttachments += 1;

          if (looksLikeStatement) {
            await this.updateIngestion(ingestion.id, {
              status: 'rejected_statement',
              error: 'Rejected: statement detected (statements never create purchase orders).',
            });
            ingestions.push((await this.getIngestion(userId, ingestion.id)) ?? ingestion);
            skipped += 1;
            continue;
          }

          if (autoCreatePurchaseOrders && isInvoice && Number.isFinite(vendorId)) {
            const lineItems = Array.isArray(normalized?.lineItems) ? normalized.lineItems : [];
            const mappedLineItems = lineItems.map((item: any) => ({
              part_number: item?.partNumber ? String(item.partNumber).trim() : '',
              part_description: item?.description ? String(item.description).trim() : '',
              unit: item?.unit ? String(item.unit).trim() : '',
              quantity: item?.quantity ?? 0,
              unit_cost: item?.unitCost ?? 0,
              line_total: item?.totalCost ?? undefined,
            }));

            const created = await this.purchaseOrderService.createPurchaseOrder({
              vendor_id: vendorId,
              bill_number: normalized?.billNumber ?? '',
              bill_date: normalized?.billDate ?? undefined,
              gst_rate: normalized?.gstRate ?? undefined,
              lineItems: mappedLineItems,
            });

            await this.updateIngestion(ingestion.id, {
              status: 'created_po',
              purchase_id: created.purchase_id,
            });

            createdPurchaseOrders += 1;
            ingestions.push((await this.getIngestion(userId, ingestion.id)) ?? ingestion);
            continue;
          }

          await this.updateIngestion(ingestion.id, {
            status: isInvoice ? 'needs_review' : 'processed',
          });

          if (isInvoice) {
            needsReview += 1;
          }

          ingestions.push((await this.getIngestion(userId, ingestion.id)) ?? ingestion);
        } catch (error: any) {
          errors += 1;
          const message = error?.message ?? 'Unknown error';
          await this.updateIngestion(ingestion.id, { status: 'error', error: message });
          ingestions.push((await this.getIngestion(userId, ingestion.id)) ?? ingestion);
        }
      }
    }

    return {
      success: true,
      query,
      maxMessages,
      scannedMessages,
      processedAttachments,
      createdPurchaseOrders,
      needsReview,
      skipped,
      errors,
      ingestions,
    };
  }

  async createPurchaseOrderFromIngestion(userId: number, ingestionId: number, overrides: { vendor_id?: number } = {}) {
    const ingestion = await this.getIngestion(userId, ingestionId);
    if (!ingestion) {
      throw new Error('Ingestion not found');
    }
    if (ingestion.purchase_id) {
      return { purchase_id: ingestion.purchase_id, purchase_number: null, alreadyCreated: true };
    }

    const normalized: any = ingestion.ocr_normalized;
    if (!normalized) {
      throw new Error('OCR normalized data not available for this ingestion');
    }
    if (normalized.documentType !== 'invoice') {
      throw new Error('Only ingestions classified as invoices can be converted to purchase orders');
    }

    const vendorId =
      (overrides.vendor_id !== undefined && overrides.vendor_id !== null ? Number(overrides.vendor_id) : NaN)
      || (normalized?.vendorMatch?.status === 'existing' ? Number(normalized?.vendorMatch?.vendorId) : NaN);

    if (!Number.isFinite(vendorId)) {
      throw new Error('vendor_id is required to create a purchase order');
    }

    const lineItems = Array.isArray(normalized?.lineItems) ? normalized.lineItems : [];
    const mappedLineItems = lineItems.map((item: any) => ({
      part_number: item?.partNumber ? String(item.partNumber).trim() : '',
      part_description: item?.description ? String(item.description).trim() : '',
      unit: item?.unit ? String(item.unit).trim() : '',
      quantity: item?.quantity ?? 0,
      unit_cost: item?.unitCost ?? 0,
      line_total: item?.totalCost ?? undefined,
    }));

    const created = await this.purchaseOrderService.createPurchaseOrder({
      vendor_id: vendorId,
      bill_number: normalized?.billNumber ?? '',
      bill_date: normalized?.billDate ?? undefined,
      gst_rate: normalized?.gstRate ?? undefined,
      lineItems: mappedLineItems,
    });

    await this.updateIngestion(ingestion.id, {
      status: 'created_po',
      purchase_id: created.purchase_id,
      error: null,
    });

    return created;
  }
}
