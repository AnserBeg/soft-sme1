import api from '../api/axios';

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

export const uploadPurchaseOrderDocument = async (file: File): Promise<PurchaseOrderOcrResponse> => {
  const formData = new FormData();
  formData.append('document', file);

  const response = await api.post<PurchaseOrderOcrResponse>('/api/purchase-orders/ocr/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const analyzePurchaseOrderRawText = async (rawText: string): Promise<PurchaseOrderOcrResponse> => {
  const response = await api.post<PurchaseOrderOcrResponse>('/api/purchase-orders/ocr/ai-review', { rawText });
  return response.data;
};
