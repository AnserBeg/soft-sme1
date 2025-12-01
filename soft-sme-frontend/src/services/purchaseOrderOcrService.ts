import api from '../api/axios';

export interface PurchaseOrderOcrVendorDetails {
  streetAddress?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactPerson?: string | null;
  telephone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface PurchaseOrderOcrVendorMatch {
  status: 'existing' | 'missing';
  vendorId?: number;
  vendorName: string | null;
  normalizedVendorName: string | null;
  matchedVendorName?: string | null;
  confidence: number;
  details?: PurchaseOrderOcrVendorDetails | null;
}

export interface PurchaseOrderOcrLineItemMatch {
  status: 'existing' | 'missing';
  normalizedPartNumber: string | null;
  matchedPartNumber?: string | null;
  partId?: number;
  partDescription?: string | null;
  unit?: string | null;
  lastUnitCost?: number | null;
  descriptionMatches?: boolean;
  suggestedPartNumber?: string | null;
}

export interface PurchaseOrderOcrLineItem {
  rawLine: string;
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
  normalizedPartNumber?: string | null;
  match?: PurchaseOrderOcrLineItemMatch | null;
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
  vendorMatch?: PurchaseOrderOcrVendorMatch | null;
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
  files?: Array<{
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
    relativePath: string;
  }>;
  ocr: {
    rawText: string;
    normalized: PurchaseOrderOcrNormalizedData;
    warnings: string[];
    notes: string[];
    processingTimeMs: number;
  };
}

export const uploadPurchaseOrderDocument = async (files: File | File[]): Promise<PurchaseOrderOcrResponse> => {
  const fileList = Array.isArray(files) ? files : [files];
  if (fileList.length === 0) {
    throw new Error('Please select at least one document to analyze.');
  }
  const formData = new FormData();
  fileList.forEach((file) => formData.append('documents', file));
  if (fileList.length === 1) {
    formData.append('document', fileList[0]);
  }

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
