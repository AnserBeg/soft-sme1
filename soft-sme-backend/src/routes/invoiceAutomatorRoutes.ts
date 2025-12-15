import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { InvoiceEmailAutomatorService } from '../services/InvoiceEmailAutomatorService';
import { pool } from '../db';

const router = express.Router();

const uploadDir = path.join(__dirname, '../../uploads/invoice-email-automator');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const service = new InvoiceEmailAutomatorService(pool, uploadDir);

router.get('/ingestions', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const limitRaw = req.query?.limit;
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    const ingestions = await service.listIngestions(userId, limit);
    res.json({ success: true, ingestions });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to load ingestions';
    res.status(500).json({ success: false, message });
  }
});

router.get('/ingestions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ingestion id' });
    }

    const ingestion = await service.getIngestion(userId, id);
    if (!ingestion) {
      return res.status(404).json({ success: false, message: 'Ingestion not found' });
    }

    res.json({ success: true, ingestion });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to load ingestion';
    res.status(500).json({ success: false, message });
  }
});

router.post('/titan/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const query = req.body?.query;
    const maxMessages = req.body?.maxMessages;
    const autoCreatePurchaseOrders = req.body?.autoCreatePurchaseOrders;

    const result = await service.syncTitanMailbox(userId, {
      query: typeof query === 'string' ? query : undefined,
      maxMessages: maxMessages !== undefined ? Number(maxMessages) : undefined,
      autoCreatePurchaseOrders: autoCreatePurchaseOrders !== undefined ? Boolean(autoCreatePurchaseOrders) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    const message = error?.message ?? 'Failed to sync Titan mailbox';
    res.status(500).json({ success: false, message });
  }
});

router.post('/ingestions/:id/create-po', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ingestion id' });
    }

    const vendorIdRaw = req.body?.vendor_id;
    const vendor_id = vendorIdRaw !== undefined ? Number(vendorIdRaw) : undefined;

    const created = await service.createPurchaseOrderFromIngestion(userId, id, {
      vendor_id: Number.isFinite(vendor_id as number) ? vendor_id : undefined,
    });

    res.json({ success: true, created });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to create purchase order';
    if (typeof message === 'string' && message.toLowerCase().includes('required')) {
      return res.status(400).json({ success: false, message });
    }
    res.status(500).json({ success: false, message });
  }
});

export default router;

