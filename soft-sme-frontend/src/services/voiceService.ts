import api from '../api/axios';

export const VoiceService = {
  startVendorCall: async (purchaseId: number) => {
    const { data } = await api.post('/api/voice/call-vendor', { purchase_id: purchaseId });
    return data as { session_id: number; status: string; vendor_phone?: string; provider?: string; reason?: string; debug?: any };
  },
  sendPOAfterCall: async (sessionId: number, overrideEmail?: string) => {
    const { data } = await api.post(`/api/voice/vendor-call/${sessionId}/send-po`, { override_email: overrideEmail });
    return data as { success: boolean; emailed_to: string; purchase_number: string };
  }
};


