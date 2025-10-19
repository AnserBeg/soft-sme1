import { Pool } from 'pg';
import { EmailService } from './emailService';
import { PDFService } from './pdfService';

export interface PurchaseOrderEmailResult {
  success: boolean;
  message: string;
  purchaseId: number;
  purchaseNumber: string;
  emailedTo: string;
  vendorName: string | null;
}

export interface QuoteEmailResult {
  success: boolean;
  message: string;
  quoteId: number;
  quoteNumber: string;
  emailedTo: string;
  customerName: string | null;
}

export class DocumentEmailService {
  private emailService: EmailService;

  private pdfService: PDFService;

  constructor(
    private readonly pool: Pool,
    emailService?: EmailService,
    pdfService?: PDFService
  ) {
    this.emailService = emailService ?? new EmailService(pool);
    this.pdfService = pdfService ?? new PDFService(pool);
  }

  private normalizeRecipients(to: string | string[] | undefined | null): string[] {
    if (Array.isArray(to)) {
      return to
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0);
    }

    if (typeof to === 'string') {
      const trimmed = to.trim();
      return trimmed ? [trimmed] : [];
    }

    return [];
  }

  async sendPurchaseOrderEmail(
    purchaseOrderId: number | string,
    to: string | string[],
    options?: { customMessage?: string | null; userId?: number | null }
  ): Promise<PurchaseOrderEmailResult> {
    const purchaseId = Number(purchaseOrderId);
    if (!Number.isFinite(purchaseId)) {
      throw new Error('purchaseOrderId is required to email a purchase order');
    }

    const recipients = this.normalizeRecipients(to);
    if (recipients.length === 0) {
      throw new Error('Recipient email is required to send a purchase order');
    }

    const businessProfileResult = await this.pool.query(
      'SELECT * FROM business_profile ORDER BY id DESC LIMIT 1'
    );
    const businessProfile = businessProfileResult.rows?.[0] ?? null;

    const purchaseResult = await this.pool.query(
      `SELECT ph.*, vm.vendor_name
       FROM purchasehistory ph
       LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
       WHERE ph.purchase_id = $1`,
      [purchaseId]
    );

    if (purchaseResult.rowCount === 0) {
      throw new Error(`Purchase order with ID ${purchaseId} not found`);
    }

    const purchase = purchaseResult.rows[0];

    const lineItemResult = await this.pool.query(
      `SELECT part_number, part_description, quantity, unit, unit_cost
       FROM purchaselineitems
       WHERE purchase_id = $1`,
      [purchaseId]
    );

    const lineItems = lineItemResult.rows ?? [];
    const totalAmount = lineItems.reduce((sum: number, item: any) => {
      const quantity = Number(item.quantity) || 0;
      const unitCost = Number(item.unit_cost) || 0;
      return sum + quantity * unitCost;
    }, 0);

    const pdfBuffer = await this.pdfService.generatePurchaseOrderPDF(purchaseId);

    const template = this.emailService.getPurchaseOrderEmailTemplate({
      purchaseOrderNumber: purchase.purchase_number,
      vendorName: purchase.vendor_name || 'Unknown Vendor',
      totalAmount,
      items: lineItems.map((item: any) => ({
        part_number: item.part_number,
        quantity: Number(item.quantity) || 0,
        unit_cost: Number(item.unit_cost) || 0,
      })),
      customMessage:
        typeof options?.customMessage === 'string' && options.customMessage.trim().length > 0
          ? options.customMessage
          : undefined,
      companyInfo: businessProfile
        ? {
            business_name: businessProfile.business_name,
            street_address: businessProfile.street_address,
            city: businessProfile.city,
            province: businessProfile.province,
            country: businessProfile.country,
            postal_code: businessProfile.postal_code,
            email: businessProfile.email,
            telephone_number: businessProfile.telephone_number,
          }
        : undefined,
    });

    const success = await this.emailService.sendEmail(
      {
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: template.subject,
        html: template.html,
        text: template.text,
        attachments: [
          {
            filename: `purchase_order_${purchase.purchase_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      },
      options?.userId ?? undefined
    );

    const recipientSummary = recipients.join(', ');

    return {
      success,
      message: success
        ? `Purchase order ${purchase.purchase_number} emailed to ${recipientSummary}.`
        : 'Failed to send purchase order email',
      purchaseId,
      purchaseNumber: purchase.purchase_number,
      emailedTo: recipientSummary,
      vendorName: purchase.vendor_name ?? null,
    };
  }

  async sendQuoteEmail(
    quoteIdInput: number | string,
    to: string | string[],
    options?: { userId?: number | null }
  ): Promise<QuoteEmailResult> {
    const quoteId = Number(quoteIdInput);
    if (!Number.isFinite(quoteId)) {
      throw new Error('quoteId is required to email a quote');
    }

    const recipients = this.normalizeRecipients(to);
    if (recipients.length === 0) {
      throw new Error('Recipient email is required to send a quote');
    }

    const quoteResult = await this.pool.query(
      `SELECT q.*, cm.customer_name, cm.email as customer_email
       FROM quotes q
       LEFT JOIN customermaster cm ON q.customer_id = cm.customer_id
       WHERE q.quote_id = $1`,
      [quoteId]
    );

    if (quoteResult.rowCount === 0) {
      throw new Error(`Quote with ID ${quoteId} not found`);
    }

    const quote = quoteResult.rows[0];

    const estimatedCost = Number(quote.estimated_cost) || 0;
    const validUntil = quote.valid_until
      ? new Date(quote.valid_until)
      : (() => {
          const base = new Date(quote.quote_date);
          base.setDate(base.getDate() + 30);
          return base;
        })();

    const pdfBuffer = await this.pdfService.generateQuotePDF(quoteId);

    const template = this.emailService.getQuoteEmailTemplate({
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name || 'Unknown Customer',
      productName: quote.product_name,
      productDescription: quote.product_description || '',
      estimatedCost,
      validUntil: validUntil.toLocaleDateString(),
    });

    const success = await this.emailService.sendEmail(
      {
        to: recipients.length === 1 ? recipients[0] : recipients,
        subject: template.subject,
        html: template.html,
        text: template.text,
        attachments: [
          {
            filename: `quote_${quote.quote_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      },
      options?.userId ?? undefined
    );

    const recipientSummary = recipients.join(', ');

    return {
      success,
      message: success
        ? `Quote ${quote.quote_number} emailed to ${recipientSummary}.`
        : 'Failed to send quote email',
      quoteId,
      quoteNumber: quote.quote_number,
      emailedTo: recipientSummary,
      customerName: quote.customer_name ?? null,
    };
  }
}

export default DocumentEmailService;
