import nodemailer from 'nodemailer';
import { Pool } from 'pg';
import PDFDocument from 'pdfkit';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailData {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private defaultTransporter!: nodemailer.Transporter;
  private pool: Pool;
  private userTransporters: Map<number, nodemailer.Transporter> = new Map();

  constructor(pool: Pool) {
    this.pool = pool;
    this.initializeDefaultTransporter();
  }

  private initializeDefaultTransporter() {
    // Default transporter for system emails
    this.defaultTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
      }
    });
  }

  // Get user-specific email settings
  async getUserEmailSettings(userId: number) {
    try {
      const result = await this.pool.query(`
        SELECT * FROM user_email_settings 
        WHERE user_id = $1 AND is_active = true
      `, [userId]);
      
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching user email settings:', error);
      return null;
    }
  }

  // Create user-specific transporter
  private async createUserTransporter(userEmailSettings: any): Promise<nodemailer.Transporter> {
    return nodemailer.createTransport({
      host: userEmailSettings.email_host,
      port: userEmailSettings.email_port,
      secure: userEmailSettings.email_secure,
      auth: {
        user: userEmailSettings.email_user,
        pass: userEmailSettings.email_pass // In production, this should be decrypted
      }
    });
  }

  // Get transporter for a specific user
  private async getTransporterForUser(userId?: number): Promise<{ transporter: nodemailer.Transporter, fromEmail?: string }> {
    if (!userId) {
      return { 
        transporter: this.defaultTransporter, 
        fromEmail: process.env.EMAIL_FROM || process.env.EMAIL_USER 
      };
    }

    // Check if we already have a cached transporter for this user
    if (this.userTransporters.has(userId)) {
      const userSettings = await this.getUserEmailSettings(userId);
      return { 
        transporter: this.userTransporters.get(userId)!, 
        fromEmail: userSettings?.email_from || userSettings?.email_user 
      };
    }

    // Get user email settings
    const userSettings = await this.getUserEmailSettings(userId);
    if (!userSettings) {
      // Fall back to default transporter if user has no settings
      return { 
        transporter: this.defaultTransporter, 
        fromEmail: process.env.EMAIL_FROM || process.env.EMAIL_USER 
      };
    }

    // Create new transporter for user
    const userTransporter = await this.createUserTransporter(userSettings);
    this.userTransporters.set(userId, userTransporter);
    
    return { 
      transporter: userTransporter, 
      fromEmail: userSettings.email_from || userSettings.email_user 
    };
  }

  async sendEmail(emailData: EmailData, userId?: number): Promise<boolean> {
    try {
      const { transporter, fromEmail } = await this.getTransporterForUser(userId);
      
      const mailOptions = {
        from: fromEmail,
        to: Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        attachments: emailData.attachments
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', info.messageId);
      
      // Log email to database
      await this.logEmail(emailData, info.messageId, userId);
      
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  private async logEmail(emailData: EmailData, messageId: string, userId?: number) {
    try {
      if (userId) {
        await this.pool.query(`
          INSERT INTO email_logs (to_email, subject, message_id, sent_at, user_id)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
        `, [
          Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to,
          emailData.subject,
          messageId,
          userId
        ]);
      } else {
        await this.pool.query(`
          INSERT INTO email_logs (to_email, subject, message_id, sent_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `, [
          Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to,
          emailData.subject,
          messageId
        ]);
      }
    } catch (error) {
      console.error('Error logging email:', error);
    }
  }

  // Email Templates
  getSalesOrderEmailTemplate(data: {
    salesOrderNumber: string;
    customerName: string;
    totalAmount: number;
    items: Array<{ part_number: string; quantity: number; unit_price: number }>;
  }): EmailTemplate {
    const itemsHtml = data.items.map(item => 
      `<tr><td>${item.part_number}</td><td>${item.quantity}</td><td>$${item.unit_price.toFixed(2)}</td></tr>`
    ).join('');

    return {
      subject: `Sales Order ${data.salesOrderNumber} - ${data.customerName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Sales Order Confirmation</h2>
          <p><strong>Order Number:</strong> ${data.salesOrderNumber}</p>
          <p><strong>Customer:</strong> ${data.customerName}</p>
          <p><strong>Total Amount:</strong> $${data.totalAmount.toFixed(2)}</p>
          
          <h3>Order Items:</h3>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Part Number</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Quantity</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Unit Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <p>Thank you for your business!</p>
        </div>
      `,
      text: `
Sales Order Confirmation
Order Number: ${data.salesOrderNumber}
Customer: ${data.customerName}
Total Amount: $${data.totalAmount.toFixed(2)}

Order Items:
${data.items.map(item => `${item.part_number} - Qty: ${item.quantity} - Price: $${item.unit_price.toFixed(2)}`).join('\n')}

Thank you for your business!
      `
    };
  }

  getPurchaseOrderEmailTemplate(data: {
    purchaseOrderNumber: string;
    vendorName: string;
    totalAmount: number;
    items: Array<{ part_number: string; quantity: number; unit_cost: number }>;
    customMessage?: string;
    companyInfo?: {
      business_name: string;
      street_address: string;
      city: string;
      province: string;
      country: string;
      postal_code?: string;
      email: string;
      telephone_number: string;
    };
  }): EmailTemplate {
    const itemsHtml = data.items.map(item => 
      `<tr><td>${item.part_number}</td><td>${item.quantity}</td><td>$${item.unit_cost.toFixed(2)}</td></tr>`
    ).join('');

    const companyAddress = [
      data.companyInfo?.street_address,
      data.companyInfo?.city,
      data.companyInfo?.province,
      data.companyInfo?.country,
      data.companyInfo?.postal_code
    ].filter(Boolean).join(', ');

    const companyInfoHtml = data.companyInfo ? `
      <div style="margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
        <h3 style="margin: 0 0 10px 0; color: #333;">From:</h3>
        <p style="margin: 5px 0; font-weight: bold;">${data.companyInfo.business_name}</p>
        <p style="margin: 5px 0;">${data.companyInfo.street_address}</p>
        <p style="margin: 5px 0;">${companyAddress}</p>
        <p style="margin: 5px 0;">Email: ${data.companyInfo.email}</p>
        <p style="margin: 5px 0;">Phone: ${data.companyInfo.telephone_number}</p>
      </div>
    ` : '';

    return {
      subject: `Purchase Order ${data.purchaseOrderNumber} - ${data.vendorName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${companyInfoHtml}
          <h2 style="color: #333;">Purchase Order</h2>
          <p><strong>PO Number:</strong> ${data.purchaseOrderNumber}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Total Amount:</strong> $${data.totalAmount.toFixed(2)}</p>
          
          <h3>Order Items:</h3>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Part Number</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Quantity</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          ${data.customMessage ? `<div style="margin: 20px 0; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #2196F3;"><p style="margin: 0;"><strong>Additional Message:</strong></p><p style="margin: 10px 0 0 0; white-space: pre-wrap;">${data.customMessage}</p></div>` : ''}
          <p>Please process this order as soon as possible.</p>
          <p><strong>Note:</strong> A detailed PDF version of this purchase order is attached to this email.</p>
        </div>
      `,
      text: `
${data.companyInfo ? `From:
${data.companyInfo.business_name}
${data.companyInfo.street_address}
${companyAddress}
Email: ${data.companyInfo.email}
Phone: ${data.companyInfo.telephone_number}

` : ''}Purchase Order
PO Number: ${data.purchaseOrderNumber}
Vendor: ${data.vendorName}
Total Amount: $${data.totalAmount.toFixed(2)}

Order Items:
${data.items.map(item => `${item.part_number} - Qty: ${item.quantity} - Cost: $${item.unit_cost.toFixed(2)}`).join('\n')}

${data.customMessage ? `\nAdditional Message:\n${data.customMessage}\n` : ''}
Please process this order as soon as possible.

Note: A detailed PDF version of this purchase order is attached to this email.
      `
    };
  }

  getQuoteEmailTemplate(data: {
    quoteNumber: string;
    customerName: string;
    productName: string;
    estimatedCost: number;
    productDescription?: string;
    validUntil: string;
  }): EmailTemplate {
    const safeEstimated = Number.isFinite(data.estimatedCost as number)
      ? (data.estimatedCost as number)
      : parseFloat(String(data.estimatedCost)) || 0;

    const productInfoHtml = `
      <h3>Quote Details:</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Description</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estimated Price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.productName}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.productDescription || ''}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">$${safeEstimated.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    `;

    return {
      subject: `Quote ${data.quoteNumber} - ${data.customerName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Quote</h2>
          <p><strong>Quote Number:</strong> ${data.quoteNumber}</p>
          <p><strong>Customer:</strong> ${data.customerName}</p>
          <p><strong>Total Amount:</strong> $${safeEstimated.toFixed(2)}</p>
          <p><strong>Valid Until:</strong> ${data.validUntil}</p>
          ${productInfoHtml}
          <p>This quote is valid until ${data.validUntil}.</p>
        </div>
      `,
      text: `
Quote
Quote Number: ${data.quoteNumber}
Customer: ${data.customerName}
Product: ${data.productName}
Estimated Price: $${safeEstimated.toFixed(2)}
Valid Until: ${data.validUntil}

This quote is valid until ${data.validUntil}.
      `
    };
  }

  getCustomEmailTemplate(subject: string, message: string): EmailTemplate {
    return {
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="white-space: pre-wrap;">${message}</div>
        </div>
      `,
      text: message
    };
  }

  // Generate purchase order PDF
  async generatePurchaseOrderPDF(purchaseOrderData: {
    purchaseOrderNumber: string;
    vendorName: string;
    totalAmount: number;
    items: Array<{ part_number: string; quantity: number; unit_cost: number; part_description?: string; unit?: string }>;
    purchaseDate?: string;
    billNumber?: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];
        
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // Header
        doc.font('Helvetica-Bold').fontSize(20).text('Purchase Order', { align: 'center' });
        doc.moveDown();
        doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Purchase Order Details
        doc.font('Helvetica-Bold').fontSize(14).text('Order Details');
        doc.moveDown();
        doc.font('Helvetica').fontSize(10);
        doc.text(`PO Number: ${purchaseOrderData.purchaseOrderNumber}`);
        doc.text(`Vendor: ${purchaseOrderData.vendorName}`);
        if (purchaseOrderData.purchaseDate) {
          doc.text(`Date: ${purchaseOrderData.purchaseDate}`);
        }
        if (purchaseOrderData.billNumber) {
          doc.text(`Bill Number: ${purchaseOrderData.billNumber}`);
        }
        doc.moveDown();

        // Items Table
        doc.font('Helvetica-Bold').fontSize(12).text('Items');
        doc.moveDown();
        
        const tableTop = doc.y;
        const tableLeft = 50;
        const colWidths = [100, 80, 80, 80, 80];
        const headers = ['Part Number', 'Description', 'Quantity', 'Unit Cost', 'Total'];
        
        // Draw headers
        doc.font('Helvetica-Bold').fontSize(10);
        headers.forEach((header, i) => {
          doc.text(header, tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0), tableTop);
        });
        
        // Draw items
        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 20;
        purchaseOrderData.items.forEach(item => {
          const total = item.quantity * item.unit_cost;
          doc.text(item.part_number, tableLeft, y);
          doc.text(item.part_description || '', tableLeft + colWidths[0], y);
          doc.text(item.quantity.toString(), tableLeft + colWidths[0] + colWidths[1], y);
          doc.text(`$${item.unit_cost.toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2], y);
          doc.text(`$${total.toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], y);
          y += 15;
        });
        
        // Total
        doc.moveDown();
        doc.font('Helvetica-Bold').fontSize(12).text(`Total: $${purchaseOrderData.totalAmount.toFixed(2)}`, { align: 'right' });
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Generate quote PDF (single product, no line items table)
  async generateQuotePDF(quoteData: {
    quoteNumber: string;
    customerName: string;
    productName: string;
    estimatedCost: number;
    productDescription?: string;
    quoteDate?: string;
    validUntil?: string;
    terms?: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];
        
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // Header
        doc.font('Helvetica-Bold').fontSize(20).text('Quote', { align: 'center' });
        doc.moveDown();
        doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Quote Details
        doc.font('Helvetica-Bold').fontSize(14).text('Quote Details');
        doc.moveDown();
        doc.font('Helvetica').fontSize(10);
        doc.text(`Quote Number: ${quoteData.quoteNumber}`);
        doc.text(`Customer: ${quoteData.customerName}`);
        if (quoteData.quoteDate) {
          doc.text(`Quote Date: ${quoteData.quoteDate}`);
        }
        if (quoteData.validUntil) {
          doc.text(`Valid Until: ${quoteData.validUntil}`);
        }
        doc.moveDown();

        // Product Summary
        doc.font('Helvetica-Bold').fontSize(12).text('Quote Summary');
        doc.moveDown();

        const tableTop = doc.y;
        const tableLeft = 50;
        const colWidths = [140, 240, 120];
        const headers = ['Product', 'Description', 'Estimated Price'];

        // Draw headers
        doc.font('Helvetica-Bold').fontSize(10);
        headers.forEach((header, i) => {
          doc.text(header, tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0), tableTop);
        });

        // Draw single product row
        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 20;
        const safeEstimated = Number.isFinite(quoteData.estimatedCost as number)
          ? (quoteData.estimatedCost as number)
          : parseFloat(String(quoteData.estimatedCost)) || 0;
        doc.text(quoteData.productName, tableLeft, y);
        doc.text(quoteData.productDescription || '', tableLeft + colWidths[0], y);
        doc.text(`$${safeEstimated.toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1], y);
        y += 20;

        // Total
        doc.moveDown();
        doc.font('Helvetica-Bold').fontSize(12).text(`Total: $${safeEstimated.toFixed(2)}`, { align: 'right' });
        
        // Terms if provided
        if (quoteData.terms) {
          doc.moveDown(2);
          doc.font('Helvetica-Bold').fontSize(12).text('Terms and Conditions');
          doc.moveDown();
          doc.font('Helvetica').fontSize(10).text(quoteData.terms);
        }
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Save user email settings
  async saveUserEmailSettings(userId: number, emailSettings: {
    email_provider: string;
    email_host: string;
    email_port: number;
    email_secure: boolean;
    email_user: string;
    email_pass?: string; // Make password optional
    email_from?: string;
  }): Promise<boolean> {
    try {
      // If no password provided, get existing password
      let finalPassword = emailSettings.email_pass;
      if (!finalPassword) {
        const existingSettings = await this.getUserEmailSettings(userId);
        if (existingSettings) {
          finalPassword = existingSettings.email_pass;
          console.log('Using existing password for user:', userId);
        } else {
          console.error('No password provided and no existing settings found for user:', userId);
          return false;
        }
      }

      // Use UPSERT to handle both insert and update cases
      await this.pool.query(`
        INSERT INTO user_email_settings 
        (user_id, email_provider, email_host, email_port, email_secure, email_user, email_pass, email_from, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) 
        DO UPDATE SET
          email_provider = EXCLUDED.email_provider,
          email_host = EXCLUDED.email_host,
          email_port = EXCLUDED.email_port,
          email_secure = EXCLUDED.email_secure,
          email_user = EXCLUDED.email_user,
          email_pass = EXCLUDED.email_pass,
          email_from = EXCLUDED.email_from,
          is_active = true,
          updated_at = CURRENT_TIMESTAMP
      `, [
        userId,
        emailSettings.email_provider,
        emailSettings.email_host,
        emailSettings.email_port,
        emailSettings.email_secure,
        emailSettings.email_user,
        finalPassword,
        emailSettings.email_from || emailSettings.email_user
      ]);

      // Clear cached transporter for this user
      this.userTransporters.delete(userId);

      console.log(`Email settings saved/updated successfully for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error saving user email settings:', error);
      return false;
    }
  }

  // Test user email configuration
  async testUserEmailConnection(userId: number): Promise<boolean> {
    try {
      const { transporter } = await this.getTransporterForUser(userId);
      await transporter.verify();
      console.log('User email service is ready for user:', userId);
      return true;
    } catch (error) {
      console.error('User email service connection failed for user:', userId, error);
      return false;
    }
  }

  // Test email configuration (default)
  async testConnection(): Promise<boolean> {
    try {
      await this.defaultTransporter.verify();
      console.log('Default email service is ready');
      return true;
    } catch (error) {
      console.error('Default email service connection failed:', error);
      return false;
    }
  }

  // Email Template Management Methods
  async createEmailTemplate(userId: number, templateData: {
    name: string;
    type: 'purchase_order' | 'quote' | 'sales_order' | 'custom';
    subject: string;
    html_content: string;
    text_content?: string;
    is_default?: boolean;
  }): Promise<number> {
    try {
      const result = await this.pool.query(`
        INSERT INTO email_templates 
        (user_id, name, type, subject, html_content, text_content, is_default, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        userId,
        templateData.name,
        templateData.type,
        templateData.subject,
        templateData.html_content,
        templateData.text_content,
        templateData.is_default || false
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error('Error creating email template:', error);
      throw error;
    }
  }

  async getUserEmailTemplates(userId: number): Promise<any[]> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM email_templates 
        WHERE user_id = $1 
        ORDER BY is_default DESC, name ASC
      `, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting user email templates:', error);
      return [];
    }
  }

  async getEmailTemplate(templateId: number, userId: number): Promise<any> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM email_templates 
        WHERE id = $1 AND user_id = $2
      `, [templateId, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting email template:', error);
      return null;
    }
  }

  async updateEmailTemplate(templateId: number, userId: number, templateData: {
    name: string;
    subject: string;
    html_content: string;
    text_content?: string;
    is_default?: boolean;
  }): Promise<boolean> {
    try {
      await this.pool.query(`
        UPDATE email_templates 
        SET name = $1, subject = $2, html_content = $3, text_content = $4, is_default = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND user_id = $7
      `, [
        templateData.name,
        templateData.subject,
        templateData.html_content,
        templateData.text_content,
        templateData.is_default || false,
        templateId,
        userId
      ]);
      return true;
    } catch (error) {
      console.error('Error updating email template:', error);
      return false;
    }
  }

  async deleteEmailTemplate(templateId: number, userId: number): Promise<boolean> {
    try {
      await this.pool.query(`
        DELETE FROM email_templates 
        WHERE id = $1 AND user_id = $2
      `, [templateId, userId]);
      return true;
    } catch (error) {
      console.error('Error deleting email template:', error);
      return false;
    }
  }

  async getDefaultTemplate(userId: number, type: 'purchase_order' | 'quote' | 'sales_order' | 'custom'): Promise<any> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM email_templates 
        WHERE user_id = $1 AND type = $2 AND is_default = true
        LIMIT 1
      `, [userId, type]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting default template:', error);
      return null;
    }
  }
}