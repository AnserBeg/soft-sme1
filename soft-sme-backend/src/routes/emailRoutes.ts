import express, { Request, Response } from 'express';
import { EmailService } from '../services/emailService';
import { PDFService } from '../services/pdfService';
import DocumentEmailService from '../services/DocumentEmailService';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentEmailService } from '../services/agentEmail/service';

const router = express.Router();
const emailService = new EmailService(pool);
const pdfService = new PDFService(pool);
const documentEmailService = new DocumentEmailService(pool, emailService, pdfService);
const agentEmailService = new AgentEmailService(pool);

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

router.post('/connect/titan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const connection = await agentEmailService.connectTitan(userId, req.body ?? {});
    res.json({ success: true, connection });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to connect Titan mailbox';
    if (typeof message === 'string' && message.toLowerCase().includes('failed to connect to titan imap')) {
      return res.status(502).json({ success: false, message });
    }
    if (typeof message === 'string' && message.toLowerCase().includes('failed to verify titan smtp')) {
      return res.status(502).json({ success: false, message });
    }
    if (typeof message === 'string' && message.toLowerCase().includes('required')) {
      return res.status(400).json({ success: false, message });
    }
    console.error('Error connecting Titan mailbox:', message);
    res.status(500).json({ success: false, message: 'Failed to connect Titan mailbox' });
  }
});

router.get('/titan/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    try {
      const results = await pool.query(
        `SELECT provider, is_active, last_validated_at
           FROM agent_email_connections
          WHERE user_id = $1 AND provider = $2
          LIMIT 1`,
        [userId, 'titan']
      );
      if (results.rowCount === 0) {
        return res.json({ success: true, connected: false });
      }
      const row = results.rows[0];
      return res.json({
        success: true,
        connected: Boolean(row.is_active),
        provider: row.provider,
        lastValidatedAt: row.last_validated_at,
      });
    } catch (dbErr) {
      console.error('Error checking titan connection status:', dbErr);
      return res.status(500).json({ success: false, message: 'Failed to check Titan connection status' });
    }
  } catch (error: any) {
    console.error('Error checking titan connection status:', error);
    res.status(500).json({ success: false, message: 'Failed to check Titan connection status' });
  }
});

router.get('/titan/search', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const q = (req.query?.q ?? '').toString();
    const maxRaw = req.query?.max;
    const max = maxRaw !== undefined ? Number(maxRaw) : undefined;

    const results = await agentEmailService.emailSearch(userId, q, Number.isFinite(max as number) ? Number(max) : undefined);
    res.json({ success: true, results });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to search Titan mailbox';
    res.status(500).json({ success: false, message });
  }
});

router.get('/titan/messages/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const message = await agentEmailService.emailRead(userId, req.params.id);
    res.json({ success: true, message });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to read Titan email';
    res.status(500).json({ success: false, message });
  }
});

router.get('/titan/messages/:id/attachments/:attachmentId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const attachment = await agentEmailService.emailGetAttachment(
      userId,
      req.params.id,
      req.params.attachmentId
    );

    res.json({ success: true, attachment });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to download Titan attachment';
    res.status(500).json({ success: false, message });
  }
});

router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await agentEmailService.disconnect(userId);
    res.json({ success: true, result });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to disconnect email provider';
    console.error('Error disconnecting email provider:', message);
    res.status(500).json({ success: false, message: 'Failed to disconnect email provider' });
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
    const purchaseOrderId = Number(req.params.purchaseOrderId);
    const { to, customMessage } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!Number.isFinite(purchaseOrderId)) {
      return res.status(400).json({ success: false, message: 'Invalid purchase order id' });
    }

    const result = await documentEmailService.sendPurchaseOrderEmail(purchaseOrderId, to, {
      customMessage,
      userId,
    });

    res.json({
      success: result.success,
      message: result.message,
      purchaseOrderNumber: result.purchaseNumber,
      emailed_to: result.emailedTo,
    });
  } catch (error: any) {
    console.error('Error sending purchase order email:', error);
    const message = error?.message ?? 'Failed to send purchase order email';
    if (typeof message === 'string' && message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, message });
    }
    if (typeof message === 'string' && message.toLowerCase().includes('recipient')) {
      return res.status(400).json({ success: false, message });
    }
    res.status(500).json({ success: false, message: 'Failed to send purchase order email' });
  }
});

// Send quote email
router.post('/quote/:quoteId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const quoteId = Number(req.params.quoteId);
    const { to } = req.body;
    const userId = req.user?.id ? parseInt(req.user.id) : undefined;

    if (!Number.isFinite(quoteId)) {
      return res.status(400).json({ success: false, message: 'Invalid quote id' });
    }

    const result = await documentEmailService.sendQuoteEmail(quoteId, to, { userId });

    res.json({
      success: result.success,
      message: result.message,
      quoteNumber: result.quoteNumber,
      emailed_to: result.emailedTo,
    });
  } catch (error: any) {
    console.error('Error sending quote email:', error);
    const message = error?.message ?? 'Failed to send quote email';
    if (typeof message === 'string' && message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, message });
    }
    if (typeof message === 'string' && message.toLowerCase().includes('recipient')) {
      return res.status(400).json({ success: false, message });
    }
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
