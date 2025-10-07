import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PurchaseOrderOcrService, PurchaseOrderOcrResponse } from '../services/PurchaseOrderOcrService';
import { PurchaseOrderAiReviewService } from '../services/PurchaseOrderAiReviewService';

const router = express.Router();

const uploadDir = path.join(__dirname, '../../uploads/purchase-order-documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const sanitizedOriginal = file.originalname.replace(/[^A-Za-z0-9.\-]/g, '_');
    const extension = path.extname(sanitizedOriginal) || path.extname(file.originalname) || '';
    const baseName = path.basename(sanitizedOriginal, extension).slice(0, 50) || 'document';
    cb(null, `${timestamp}-${baseName}${extension}`);
  },
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/bmp',
  'image/gif',
  'image/webp',
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF or image.'));
    }
  },
});

const ocrService = new PurchaseOrderOcrService(uploadDir);

router.post('/upload', (req: Request, res: Response) => {
  upload.single('document')(req, res, async (err: any) => {
    if (err) {
      console.error('purchaseOrderOcrRoutes: Upload error', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File is too large. Maximum size is 25MB.' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message || 'Failed to upload document.' });
    }

    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: 'No document uploaded.' });
      }

      const result = await ocrService.processDocument(file);

      console.log(
        'purchaseOrderOcrRoutes: AI review processed successfully',
        JSON.stringify({ uploadId: result.uploadId, file: result.file }, null, 2)
      );

      return res.json(result);
    } catch (error: any) {
      console.error('purchaseOrderOcrRoutes: Failed to process document with AI review', error);
      return res.status(500).json({
        error: 'Failed to analyze the document with AI.',
        details: error?.message,
      });
    }
  });
});

router.post('/ai-review', async (req: Request, res: Response) => {
  const start = Date.now();
  const rawText = (req.body?.rawText ?? '').toString();

  if (!rawText || rawText.trim().length === 0) {
    return res.status(400).json({ error: 'Raw text is required.' });
  }

  try {
    const userId = req.user?.id ? Number(req.user.id) : undefined;
    const aiResult = await PurchaseOrderAiReviewService.reviewRawText(rawText, {
      userId: Number.isNaN(userId) ? undefined : userId,
    });

    const response: PurchaseOrderOcrResponse = {
      source: 'ai',
      ocr: {
        rawText,
        normalized: aiResult.normalized,
        warnings: aiResult.warnings,
        notes: aiResult.notes,
        processingTimeMs: Date.now() - start,
      },
    };

    console.log('purchaseOrderOcrRoutes: AI review completed');

    return res.json(response);
  } catch (error: any) {
    console.error('purchaseOrderOcrRoutes: AI review failed', error);
    const status = error?.message === 'Gemini API key not configured' ? 500 : 502;
    const message = error?.message || 'Failed to analyze raw text with AI.';
    return res.status(status).json({
      error: 'Failed to analyze raw text with AI.',
      details: message,
    });
  }
});

export default router;
