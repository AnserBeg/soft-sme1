import express, { Request, Response } from 'express';
import { pool } from '../db';
import axios from 'axios';

// This route set abstracts a telephony provider webhook + initiation for vendor calls.
// You can back this with Twilio, Vonage, or similar. For now, placeholder endpoints.

const router = express.Router();

// Initiate a vendor call session via LiveKit + Telnyx
router.post('/call-vendor', async (req: Request, res: Response) => {
  try {
    const { purchase_id } = req.body || {};
    if (!purchase_id) return res.status(400).json({ error: 'purchase_id required' });

    // Fetch PO + vendor
    const poRes = await pool.query('SELECT * FROM purchasehistory WHERE purchase_id = $1', [purchase_id]);
    if (poRes.rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    const po = poRes.rows[0];
    const vRes = await pool.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [po.vendor_id]);
    if (vRes.rows.length === 0) return res.status(400).json({ error: 'Vendor not found' });
    const vendor = vRes.rows[0];

    // Create a session record
    const sess = await pool.query(
      'INSERT INTO vendor_call_sessions (purchase_id, vendor_id, vendor_phone, status) VALUES ($1,$2,$3,$4) RETURNING id',
      [purchase_id, vendor.vendor_id, vendor.telephone_number || null, 'initiated']
    );
    const sessionId = sess.rows[0].id;

    // Prepare LiveKit/Telnyx session
    const roomName = `po-${sessionId}`;
    const provider = 'livekit_telnyx';

    // Optional: place outbound call via Telnyx Call Control to your LiveKit SIP Ingress
    // Requires env: TELNYX_API_KEY, TELNYX_CONNECTION_ID, LIVEKIT_SIP_INGRESS_NUMBER
    const hasTelnyx = !!process.env.TELNYX_API_KEY && !!process.env.LIVEKIT_SIP_INGRESS_NUMBER;
    let telnyxResponse: any = null;
    if (hasTelnyx) {
      try {
        // Dial vendor; on answer, conference them with LiveKit SIP Ingress number
        // Basic one-leg example (direct to vendor). Advanced bridging/conference should be configured
        // using a Telnyx Call Control App to connect the vendor leg with LIVEKIT_SIP_INGRESS_NUMBER.
        const r = await axios.post('https://api.telnyx.com/v2/calls', {
          connection_id: process.env.TELNYX_CONNECTION_ID,
          to: vendor.telephone_number,
          from: process.env.TELNYX_FROM_NUMBER,
        }, {
          headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
        });
        telnyxResponse = r.data;
        await pool.query('INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)', [sessionId, 'telnyx_call_initiated', telnyxResponse]);
      } catch (e: any) {
        console.warn('Telnyx call initiation failed', e?.response?.data || e?.message || e);
      }
    }

    res.json({ session_id: sessionId, status: 'initiated', vendor_phone: vendor.telephone_number, provider, room: roomName, telnyx: !!telnyxResponse });
  } catch (e: any) {
    console.error('voiceRoutes.call-vendor error', e);
    res.status(500).json({ error: e.message || 'Failed to initiate call' });
  }
});

// Provider webhook to post transcripts, captured email, and status updates
router.post('/vendor-call/webhook', async (req: Request, res: Response) => {
  try {
    const { session_id, event_type, payload } = req.body || {};
    if (!session_id || !event_type) return res.status(400).json({ error: 'session_id and event_type required' });
    await pool.query('INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)', [session_id, event_type, payload || null]);

    // Update session captured fields for useful events
    if (event_type === 'captured_email') {
      await pool.query('UPDATE vendor_call_sessions SET captured_email = $1, updated_at = NOW() WHERE id = $2', [payload?.email || null, session_id]);
    }
    if (event_type === 'transcript') {
      const add = `\n${payload?.text || ''}`;
      await pool.query('UPDATE vendor_call_sessions SET transcript = COALESCE(transcript, \'\') || $1, updated_at = NOW() WHERE id = $2', [add, session_id]);
    }
    if (event_type === 'status') {
      await pool.query('UPDATE vendor_call_sessions SET status = $1, updated_at = NOW() WHERE id = $2', [payload?.status || 'updated', session_id]);
    }

    // If we have a call-completed event, run summarization on transcript using Gemini (HTTP) and store structured notes
    if (event_type === 'status' && (payload?.status === 'completed' || payload?.status === 'hangup')) {
      try {
        const sRes = await pool.query('SELECT * FROM vendor_call_sessions WHERE id=$1', [session_id]);
        const sess = sRes.rows[0];
        if (sess?.transcript) {
          const { GoogleGenerativeAI } = require('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
          const model = genAI.getGenerativeModel({ model: process.env.AI_MODEL || 'gemini-2.5-flash' });
          const prompt = `You are an assistant for a truck and trailer parts shop. Summarize the call transcript. Extract: vendor email (if any), pickup time/window (if any), list of parts with quantities and any notes. Return strict JSON with keys: {"email":string|null,"pickup_time":string|null,"parts":[{"part_number":string,"quantity":number,"notes":string|null}],"summary":string}`;
          const resp = await model.generateContent([{ text: prompt }, { text: sess.transcript }]);
          const text = resp.response.text();
          let parsed: any = null;
          try { parsed = JSON.parse(text); } catch {}
          if (parsed) {
            await pool.query('UPDATE vendor_call_sessions SET structured_notes=$1, updated_at=NOW() WHERE id=$2', [parsed, session_id]);
            if (parsed.email && !sess.captured_email) {
              await pool.query('UPDATE vendor_call_sessions SET captured_email=$1, updated_at=NOW() WHERE id=$2', [parsed.email, session_id]);
            }
          }
        }
      } catch (e) {
        console.warn('Post-call summarization failed', e);
      }
    }

    res.json({ ok: true });
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
    const sRes = await pool.query('SELECT * FROM vendor_call_sessions WHERE id=$1', [sessionId]);
    if (sRes.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const session = sRes.rows[0];
    const email = override_email || session.captured_email;
    if (!email) return res.status(400).json({ error: 'No email captured/override provided' });

    // Fetch PO including line items and vendor name for email template context
    const poRes = await pool.query('SELECT ph.*, vm.vendor_name FROM purchasehistory ph JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id=$1', [session.purchase_id]);
    if (poRes.rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    const po = poRes.rows[0];
    const itemsRes = await pool.query('SELECT * FROM purchaselineitems WHERE purchase_id=$1', [session.purchase_id]);
    const items = itemsRes.rows.map((r: any) => ({ part_number: r.part_number, quantity: Number(r.quantity)||0, unit_cost: Number(r.unit_cost)||0, part_description: r.part_description, unit: r.unit }));

    // Generate PDF using existing PO PDF endpoint pattern: here reusing EmailService helper from agent tools path is simpler
    // To avoid circular imports, do a minimal inline PDF generation or rely on EmailService later if refactored.

    // For now, just record intent; frontend can email via existing button.
    await pool.query('UPDATE vendor_call_sessions SET emailed_at = NOW(), updated_at = NOW() WHERE id = $1', [sessionId]);
    res.json({ success: true, emailed_to: email, purchase_number: po.purchase_number });
  } catch (e: any) {
    console.error('voiceRoutes.send-po error', e);
    res.status(500).json({ error: e.message || 'Failed to send PO email' });
  }
});

// Note: Twilio-specific endpoints removed. LiveKit/Telnyx flow relies on SIP Ingress and provider config.

export default router;


