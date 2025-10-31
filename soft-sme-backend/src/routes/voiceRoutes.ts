import express, { Request, Response } from 'express';
import { pool } from '../db';
import { VoiceService } from '../services/voice/VoiceService';

// This route set abstracts a telephony provider webhook + initiation for vendor calls.
// You can back this with Twilio, Vonage, or similar. For now, placeholder endpoints.

const router = express.Router();
const voiceService = new VoiceService(pool);

// Initiate a vendor call session via LiveKit + Telnyx
router.post('/call-vendor', async (req: Request, res: Response) => {
  try {
    const { purchase_id, agent_session_id } = req.body || {};
    const session = await voiceService.initiateVendorCall(Number(purchase_id), {
      agentSessionId: agent_session_id ? Number(agent_session_id) : undefined,
    });
    const roomName = `po-${session.id}`;
    res.json({
      session_id: session.id,
      status: session.status,
      vendor_phone: session.vendor_phone,
      provider: 'livekit_telnyx',
      room: roomName,
      telnyx: session.telnyxPlaced ?? false,
      session,
    });
  } catch (e: any) {
    console.error('voiceRoutes.call-vendor error', e);
    res.status(500).json({ error: e.message || 'Failed to initiate call' });
  }
});

// Provider webhook to post transcripts, captured email, and status updates
router.post('/vendor-call/webhook', async (req: Request, res: Response) => {
  try {
    const { session_id, event_type, payload } = req.body || {};
    const session = await voiceService.recordVendorCallEvent(Number(session_id), event_type, payload);
    res.json({ ok: true, session });
  } catch (e: any) {
    console.error('voiceRoutes.vendor-call webhook error', e);
    res.status(500).json({ error: e.message || 'Failed to record event' });
  }
});

// After call completes, optionally email the PO PDF to captured email
router.post('/vendor-call/:sessionId/send-po', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { override_email } = req.body || {};
    const result = await voiceService.sendPurchaseOrderEmail(Number(sessionId), override_email);
    res.json(result);
  } catch (e: any) {
    console.error('voiceRoutes.send-po error', e);
    res.status(500).json({ error: e.message || 'Failed to send PO email' });
  }
});

router.get('/vendor-call/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = await voiceService.getSession(Number(req.params.sessionId), { includeEvents: true });
    res.json(session);
  } catch (e: any) {
    res.status(404).json({ error: e.message || 'Session not found' });
  }
});

// Note: Twilio-specific endpoints removed. LiveKit/Telnyx flow relies on SIP Ingress and provider config.

export default router;


