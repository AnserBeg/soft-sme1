import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PurchaseOrderOcrService } from '../services/PurchaseOrderOcrService';

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
        'purchaseOrderOcrRoutes: OCR processed successfully',
        JSON.stringify({ uploadId: result.uploadId, file: result.file }, null, 2)
      );

      return res.json(result);
    } catch (error: any) {
      console.error('purchaseOrderOcrRoutes: Failed to process document', error);
      return res.status(500).json({
        error: 'Failed to process document with OCR.',
        details: error?.message,
      });
    }
  });
});

export default router;
