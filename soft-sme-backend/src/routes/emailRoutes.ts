import express, { Request, Response } from 'express';
import { EmailService } from '../services/emailService';
import { PDFService } from '../services/pdfService';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();
const emailService = new EmailService(pool);
const pdfService = new PDFService(pool);

// Test email configuration
router.get('/test', async (req: Request, res: Response) => {
  try {
    const isConnected = await emailService.testConnection();
    res.json({ success: isConnected, message: isConnected ? 'Email service is ready' : 'Email service connection failed' });
  } catch (error) {
    console.error('Error testing email service:', error);
    res.status(500).json({ success: false, message: 'Failed to test email service' });
  }
});

// Send custom email
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { to, subject, message, attachments } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!to || !subject || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields: to, subject, message' });
    }

    const template = emailService.getCustomEmailTemplate(subject, message);
    const success = await emailService.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments
    }, userId);

    res.json({ success, message: success ? 'Email sent successfully' : 'Failed to send email' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
});

// Send sales order email
router.post('/sales-order/:salesOrderId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { salesOrderId } = req.params;
    const { to } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!to) {
      return res.status(400).json({ success: false, message: 'Missing recipient email' });
    }

    // Get sales order details
    const salesOrderResult = await pool.query(`
      SELECT soh.*, cm.customer_name 
      FROM salesorderhistory soh
      LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
      WHERE soh.sales_order_id = $1
    `, [salesOrderId]);

    if (salesOrderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }

    const salesOrder = salesOrderResult.rows[0];

    // Get line items
    const lineItemsResult = await pool.query(`
      SELECT part_number, quantity, unit_price
      FROM salesorderlineitems
      WHERE sales_order_id = $1
    `, [salesOrderId]);

    const items = lineItemsResult.rows;
    const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unit_price)), 0);

    const template = emailService.getSalesOrderEmailTemplate({
      salesOrderNumber: salesOrder.sales_order_number,
      customerName: salesOrder.customer_name || 'Unknown Customer',
      totalAmount,
      items: items.map(item => ({
        part_number: item.part_number,
        quantity: parseFloat(item.quantity),
        unit_price: parseFloat(item.unit_price)
      }))
    });

    const success = await emailService.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text
    }, userId);

    res.json({ success, message: success ? 'Sales order email sent successfully' : 'Failed to send sales order email' });
  } catch (error) {
    console.error('Error sending sales order email:', error);
    res.status(500).json({ success: false, message: 'Failed to send sales order email' });
  }
});

// Send purchase order email
router.post('/purchase-order/:purchaseOrderId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { purchaseOrderId } = req.params;
    const { to, customMessage } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!to) {
      return res.status(400).json({ success: false, message: 'Missing recipient email' });
    }

    // Get business profile for company information
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    // Get purchase order details
    const purchaseOrderResult = await pool.query(`
      SELECT ph.*, vm.vendor_name 
      FROM purchasehistory ph
      LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
      WHERE ph.purchase_id = $1
    `, [purchaseOrderId]);

    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    const purchaseOrder = purchaseOrderResult.rows[0];

    // Get line items with additional details
    const lineItemsResult = await pool.query(`
      SELECT part_number, part_description, quantity, unit, unit_cost
      FROM purchaselineitems
      WHERE purchase_id = $1
    `, [purchaseOrderId]);

    const items = lineItemsResult.rows;
    const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unit_cost)), 0);

    // Generate PDF attachment using the same professional format as download
    const pdfBuffer = await pdfService.generatePurchaseOrderPDF(parseInt(purchaseOrderId));

    const template = emailService.getPurchaseOrderEmailTemplate({
      purchaseOrderNumber: purchaseOrder.purchase_number,
      vendorName: purchaseOrder.vendor_name || 'Unknown Vendor',
      totalAmount,
      items: items.map(item => ({
        part_number: item.part_number,
        quantity: parseFloat(item.quantity),
        unit_cost: parseFloat(item.unit_cost)
      })),
      customMessage: customMessage || undefined,
      companyInfo: businessProfile ? {
        business_name: businessProfile.business_name,
        street_address: businessProfile.street_address,
        city: businessProfile.city,
        province: businessProfile.province,
        country: businessProfile.country,
        postal_code: businessProfile.postal_code,
        email: businessProfile.email,
        telephone_number: businessProfile.telephone_number
      } : undefined
    });

    const success = await emailService.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: [{
        filename: `purchase_order_${purchaseOrder.purchase_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    }, userId);

    res.json({ success, message: success ? 'Purchase order email sent successfully' : 'Failed to send purchase order email' });
  } catch (error) {
    console.error('Error sending purchase order email:', error);
    res.status(500).json({ success: false, message: 'Failed to send purchase order email' });
  }
});

// Send quote email
router.post('/quote/:quoteId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { quoteId } = req.params;
    const { to, customMessage } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!to) {
      return res.status(400).json({ success: false, message: 'Missing recipient email' });
    }

    // Get quote details
    const quoteResult = await pool.query(`
      SELECT q.*, cm.customer_name, cm.email as customer_email
      FROM quotes q
      LEFT JOIN customermaster cm ON q.customer_id = cm.customer_id
      WHERE q.quote_id = $1
    `, [quoteId]);

    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // In quotes, we treat the quote as a single product with estimated cost (no line items)
    const estimatedCost = parseFloat(quote.estimated_cost);

    // Calculate valid until date (30 days from quote date)
    const validUntil = new Date(quote.quote_date);
    validUntil.setDate(validUntil.getDate() + 30);

    // Generate PDF attachment using the exact same renderer as the download endpoint
    const pdfBuffer = await pdfService.generateQuotePDF(parseInt(quoteId));

    const template = emailService.getQuoteEmailTemplate({
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name || 'Unknown Customer',
      productName: quote.product_name,
      productDescription: quote.product_description || '',
      estimatedCost: estimatedCost,
      validUntil: validUntil.toLocaleDateString()
    });

    const success = await emailService.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: [{
        filename: `quote_${quote.quote_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    }, userId);

    res.json({ success, message: success ? 'Quote email sent successfully' : 'Failed to send quote email' });
  } catch (error) {
    console.error('Error sending quote email:', error);
    res.status(500).json({ success: false, message: 'Failed to send quote email' });
  }
});

// Get email logs
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM email_logs 
      ORDER BY sent_at DESC 
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching email logs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch email logs' });
  }
});

// Get user email settings
router.get('/user-settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const settings = await emailService.getUserEmailSettings(userId);
    if (settings) {
      // Don't send the password back to the frontend
      const { email_pass, ...safeSettings } = settings;
      res.json({ success: true, settings: safeSettings });
    } else {
      res.json({ success: true, settings: null });
    }
  } catch (error) {
    console.error('Error fetching user email settings:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user email settings' });
  }
});

// Save user email settings
router.post('/user-settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { email_provider, email_host, email_port, email_secure, email_user, email_pass, email_from } = req.body;

    if (!email_host || !email_port || !email_user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: email_host, email_port, email_user' 
      });
    }

    // If no password provided, we'll keep the existing password
    if (!email_pass) {
      console.log('No password provided - will keep existing password for user:', userId);
    }

    const success = await emailService.saveUserEmailSettings(userId, {
      email_provider: email_provider || 'custom',
      email_host,
      email_port: parseInt(email_port),
      email_secure: email_secure === true || email_secure === 'true',
      email_user,
      email_pass,
      email_from
    });

    res.json({ 
      success, 
      message: success ? 'Email settings saved successfully' : 'Failed to save email settings' 
    });
  } catch (error) {
    console.error('Error saving user email settings:', error);
    res.status(500).json({ success: false, message: 'Failed to save email settings' });
  }
});

// Test user email connection
router.post('/test-user-connection', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const success = await emailService.testUserEmailConnection(userId);
    res.json({ 
      success, 
      message: success ? 'Email connection test successful' : 'Email connection test failed' 
    });
  } catch (error) {
    console.error('Error testing user email connection:', error);
    res.status(500).json({ success: false, message: 'Failed to test email connection' });
  }
});

// Email Template Management Routes
router.get('/templates', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const templates = await emailService.getUserEmailTemplates(userId);
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Error getting email templates:', error);
    res.status(500).json({ success: false, message: 'Failed to get email templates' });
  }
});

router.get('/templates/:templateId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const template = await emailService.getEmailTemplate(parseInt(templateId), userId);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, template });
  } catch (error) {
    console.error('Error getting email template:', error);
    res.status(500).json({ success: false, message: 'Failed to get email template' });
  }
});

router.post('/templates', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { name, type, subject, html_content, text_content, is_default } = req.body;

    if (!name || !type || !subject || !html_content) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const templateId = await emailService.createEmailTemplate(userId, {
      name,
      type,
      subject,
      html_content,
      text_content,
      is_default
    });

    res.json({ success: true, templateId, message: 'Email template created successfully' });
  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({ success: false, message: 'Failed to create email template' });
  }
});

router.put('/templates/:templateId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const { name, subject, html_content, text_content, is_default } = req.body;

    if (!name || !subject || !html_content) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const success = await emailService.updateEmailTemplate(parseInt(templateId), userId, {
      name,
      subject,
      html_content,
      text_content,
      is_default
    });

    if (success) {
      res.json({ success: true, message: 'Email template updated successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Template not found or update failed' });
    }
  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({ success: false, message: 'Failed to update email template' });
  }
});

router.delete('/templates/:templateId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const success = await emailService.deleteEmailTemplate(parseInt(templateId), userId);

    if (success) {
      res.json({ success: true, message: 'Email template deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Template not found or delete failed' });
    }
  } catch (error) {
    console.error('Error deleting email template:', error);
    res.status(500).json({ success: false, message: 'Failed to delete email template' });
  }
});

router.get('/templates/default/:type', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const template = await emailService.getDefaultTemplate(userId, type as any);
    res.json({ success: true, template });
  } catch (error) {
    console.error('Error getting default template:', error);
    res.status(500).json({ success: false, message: 'Failed to get default template' });
  }
});

export default router; 