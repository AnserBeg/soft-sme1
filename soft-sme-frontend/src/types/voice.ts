export interface VoiceVendorInfo {
  id?: number;
  name?: string | null;
  phone?: string | null;
}

export interface VoiceCallPart {
  part_number: string;
  quantity: number;
  notes?: string | null;
}

export interface VoiceCallArtifact {
  type?: string;
  sessionId: number;
  status: string;
  purchaseId?: number;
  purchaseNumber?: string | null;
  vendor?: VoiceVendorInfo;
  capturedEmail?: string | null;
  pickupTime?: string | null;
  parts?: VoiceCallPart[];
  summary?: string | null;
  nextSteps?: string[];
  transcriptPreview?: string | null;
}
