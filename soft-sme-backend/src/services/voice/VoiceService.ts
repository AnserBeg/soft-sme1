import { Pool } from 'pg';
import axios, { AxiosInstance } from 'axios';

export interface VoiceCallPartNote {
  part_number: string;
  quantity: number;
  notes?: string | null;
}

export interface VoiceStructuredNotes {
  email?: string | null;
  pickup_time?: string | null;
  parts?: VoiceCallPartNote[];
  summary?: string | null;
  next_steps?: string[];
}

export interface VoiceCallSessionRecord {
  id: number;
  purchase_id: number;
  vendor_id: number;
  vendor_phone: string | null;
  status: string;
  captured_email: string | null;
  emailed_at: Date | null;
  structured_notes: VoiceStructuredNotes | null;
  transcript: string | null;
  created_at: Date;
  updated_at: Date;
  purchase_number?: string | null;
  pickup_time?: string | null;
  pickup_notes?: string | null;
  pickup_location?: string | null;
  pickup_contact_person?: string | null;
  pickup_phone?: string | null;
  vendor_name?: string | null;
}

export interface VoiceCallEventRecord {
  id: number;
  session_id: number;
  event_type: string;
  payload: any;
  created_at: Date;
}

interface GetSessionOptions {
  includeEvents?: boolean;
}

export class VoiceService {
  constructor(private pool: Pool, private httpClient: AxiosInstance = axios) {}

  async initiateVendorCall(purchaseId: number) {
    if (!purchaseId || Number.isNaN(Number(purchaseId))) {
      throw new Error('purchase_id required');
    }

    const purchaseRes = await this.pool.query(
      'SELECT purchase_id, vendor_id, purchase_number FROM purchasehistory WHERE purchase_id = $1',
      [purchaseId]
    );
    if (purchaseRes.rows.length === 0) {
      throw new Error('PO not found');
    }
    const purchase = purchaseRes.rows[0];

    const vendorRes = await this.pool.query(
      'SELECT vendor_id, vendor_name, telephone_number FROM vendormaster WHERE vendor_id = $1',
      [purchase.vendor_id]
    );
    if (vendorRes.rows.length === 0) {
      throw new Error('Vendor not found');
    }
    const vendor = vendorRes.rows[0];

    const insertRes = await this.pool.query(
      `INSERT INTO vendor_call_sessions (purchase_id, vendor_id, vendor_phone, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [purchase.purchase_id, vendor.vendor_id, vendor.telephone_number || null, 'initiated']
    );
    const sessionId = insertRes.rows[0].id as number;

    const telnyxConfigured = !!process.env.TELNYX_API_KEY && !!process.env.LIVEKIT_SIP_INGRESS_NUMBER;
    let telnyxPlaced = false;

    if (telnyxConfigured) {
      try {
        const payload: Record<string, any> = {
          connection_id: process.env.TELNYX_CONNECTION_ID,
          to: vendor.telephone_number,
          from: process.env.TELNYX_FROM_NUMBER,
        };
        const response = await this.httpClient.post('https://api.telnyx.com/v2/calls', payload, {
          headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
        });
        telnyxPlaced = true;
        await this.pool.query(
          'INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)',
          [sessionId, 'telnyx_call_initiated', response.data || null]
        );
      } catch (error: any) {
        const message = error?.response?.data || error?.message || 'Call initiation failed';
        await this.pool.query(
          'INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)',
          [sessionId, 'telnyx_call_failed', message]
        );
      }
    }

    return {
      ...(await this.getSession(sessionId)),
      telnyxPlaced,
    };
  }

  async getSession(sessionId: number, options: GetSessionOptions = {}) {
    const sessionRes = await this.pool.query(
      `SELECT s.*, ph.purchase_number, ph.pickup_time, ph.pickup_notes, ph.pickup_location, ph.pickup_contact_person,
              ph.pickup_phone, vm.vendor_name
         FROM vendor_call_sessions s
         JOIN purchasehistory ph ON ph.purchase_id = s.purchase_id
         JOIN vendormaster vm ON vm.vendor_id = s.vendor_id
        WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionRes.rows.length === 0) {
      throw new Error('Session not found');
    }

    const record = this.deserializeSession(sessionRes.rows[0]);

    if (!options.includeEvents) {
      return record;
    }

    const eventsRes = await this.pool.query(
      'SELECT id, session_id, event_type, payload, created_at FROM vendor_call_events WHERE session_id = $1 ORDER BY id',
      [sessionId]
    );

    const events: VoiceCallEventRecord[] = eventsRes.rows.map((row) => ({
      id: Number(row.id),
      session_id: Number(row.session_id),
      event_type: row.event_type,
      payload: row.payload,
      created_at: row.created_at,
    }));

    return {
      ...record,
      events,
    };
  }

  async recordVendorCallEvent(sessionId: number, eventType: string, payload: any) {
    if (!sessionId) {
      throw new Error('session_id required');
    }
    if (!eventType) {
      throw new Error('event_type required');
    }

    await this.pool.query(
      'INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)',
      [sessionId, eventType, payload ?? null]
    );

    if (eventType === 'captured_email') {
      await this.pool.query(
        'UPDATE vendor_call_sessions SET captured_email = $1, updated_at = NOW() WHERE id = $2',
        [payload?.email || null, sessionId]
      );
    }

    if (eventType === 'transcript') {
      const text = payload?.text ? `\n${payload.text}` : '';
      await this.pool.query(
        'UPDATE vendor_call_sessions SET transcript = COALESCE(transcript, \'\') || $1, updated_at = NOW() WHERE id = $2',
        [text, sessionId]
      );
    }

    if (eventType === 'status') {
      await this.pool.query(
        'UPDATE vendor_call_sessions SET status = $1, updated_at = NOW() WHERE id = $2',
        [payload?.status || 'updated', sessionId]
      );

      if (['completed', 'hangup', 'failed'].includes((payload?.status || '').toLowerCase())) {
        await this.handleCompletion(sessionId, payload?.status || 'completed');
      }
    }

    return this.getSession(sessionId, { includeEvents: true });
  }

  async sendPurchaseOrderEmail(sessionId: number, overrideEmail?: string) {
    const sessionRes = await this.pool.query('SELECT * FROM vendor_call_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) {
      throw new Error('Session not found');
    }
    const session = sessionRes.rows[0];
    const email = overrideEmail || session.captured_email;
    if (!email) {
      throw new Error('No email captured/override provided');
    }

    const poRes = await this.pool.query(
      'SELECT ph.*, vm.vendor_name FROM purchasehistory ph JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id=$1',
      [session.purchase_id]
    );
    if (poRes.rows.length === 0) {
      throw new Error('PO not found');
    }
    const itemsRes = await this.pool.query('SELECT * FROM purchaselineitems WHERE purchase_id=$1', [session.purchase_id]);
    const items = itemsRes.rows.map((row: any) => ({
      part_number: row.part_number,
      quantity: Number(row.quantity) || 0,
      unit_cost: Number(row.unit_cost) || 0,
      part_description: row.part_description,
      unit: row.unit,
    }));

    await this.pool.query('UPDATE vendor_call_sessions SET emailed_at = NOW(), updated_at = NOW() WHERE id = $1', [sessionId]);

    return {
      success: true,
      emailed_to: email,
      purchase_number: poRes.rows[0].purchase_number,
      items,
    };
  }

  private deserializeSession(row: any): VoiceCallSessionRecord {
    const structuredNotes =
      row.structured_notes === null || typeof row.structured_notes === 'object'
        ? row.structured_notes
        : null;
    return {
      id: Number(row.id),
      purchase_id: Number(row.purchase_id),
      vendor_id: Number(row.vendor_id),
      vendor_phone: row.vendor_phone,
      status: row.status,
      captured_email: row.captured_email,
      emailed_at: row.emailed_at,
      structured_notes: structuredNotes,
      transcript: row.transcript,
      created_at: row.created_at,
      updated_at: row.updated_at,
      purchase_number: row.purchase_number,
      pickup_time: row.pickup_time,
      pickup_notes: row.pickup_notes,
      pickup_location: row.pickup_location,
      pickup_contact_person: row.pickup_contact_person,
      pickup_phone: row.pickup_phone,
      vendor_name: row.vendor_name,
    };
  }

  private async handleCompletion(sessionId: number, status: string) {
    const session = await this.getSession(sessionId);
    const structured = await this.ensureStructuredNotes(session);
    if (structured?.email && !session.captured_email) {
      await this.pool.query(
        'UPDATE vendor_call_sessions SET captured_email = $1, updated_at = NOW() WHERE id = $2',
        [structured.email, sessionId]
      );
    }

    if (structured) {
      await this.pool.query(
        'UPDATE vendor_call_sessions SET structured_notes = $1, updated_at = NOW() WHERE id = $2',
        [structured, sessionId]
      );
    }

    const summaryText = this.buildSummaryMessage(session, structured, status);
    await this.pool.query(
      'INSERT INTO vendor_call_events (session_id, event_type, payload) VALUES ($1,$2,$3)',
      [session.id, 'summary', { summary: summaryText }]
    );
  }

  private async ensureStructuredNotes(session: VoiceCallSessionRecord): Promise<VoiceStructuredNotes | null> {
    if (session.structured_notes) {
      return this.attachNextSteps(session, session.structured_notes);
    }
    if (!session.transcript) {
      return null;
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_SUMMARY_MODEL || 'gemini-1.5-flash' });
        const prompt =
          'You are an assistant for a truck and trailer parts shop. Summarize the call transcript. Extract: vendor email (if any), pickup time/window (if any), list of parts with quantities and any notes. Return strict JSON with keys: {"email":string|null,"pickup_time":string|null,"parts":[{"part_number":string,"quantity":number,"notes":string|null}],"summary":string}';
        const resp = await model.generateContent([{ text: prompt }, { text: session.transcript }]);
        const text = resp.response.text();
        const parsed = JSON.parse(text);
        return this.attachNextSteps(session, parsed);
      } catch (error) {
        // Fall back to simple parsing below
      }
    }

    // Fallback summarization using captured fields
    return this.attachNextSteps(session, {
      email: session.captured_email || null,
      pickup_time: session.pickup_time || null,
      parts: [],
      summary: session.transcript ? session.transcript.split('\n').slice(-3).join('\n') : null,
    });
  }

  private attachNextSteps(
    session: VoiceCallSessionRecord,
    notes: VoiceStructuredNotes
  ): VoiceStructuredNotes {
    const nextSteps: string[] = [];
    const email = notes.email || session.captured_email;
    if (!email) {
      nextSteps.push('Capture vendor email to send PO.');
    } else {
      nextSteps.push(`Send PO to ${email}.`);
    }
    if (!session.emailed_at) {
      nextSteps.push('Email the finalized purchase order PDF.');
    }
    if (notes.pickup_time || session.pickup_time) {
      nextSteps.push(`Confirm pickup at ${notes.pickup_time || session.pickup_time}.`);
    }
    if (!nextSteps.length) {
      nextSteps.push('No immediate follow-up required.');
    }
    return {
      ...notes,
      next_steps: nextSteps,
    };
  }

  private buildSummaryMessage(
    session: VoiceCallSessionRecord,
    notes: VoiceStructuredNotes | null,
    status: string
  ): string {
    const summaryPayload = {
      type: 'vendor_call_summary',
      sessionId: session.id,
      status,
      purchaseId: session.purchase_id,
      purchaseNumber: session.purchase_number,
      vendor: {
        id: session.vendor_id,
        name: session.vendor_name,
        phone: session.vendor_phone,
      },
      capturedEmail: notes?.email || session.captured_email || null,
      pickupTime: notes?.pickup_time || session.pickup_time || null,
      parts: notes?.parts || [],
      summary: notes?.summary || null,
      nextSteps: notes?.next_steps || [],
      transcriptPreview: session.transcript ? session.transcript.split('\n').slice(-4).join('\n') : null,
    };

    const headline = `Vendor call ${status.toLowerCase()} for PO ${session.purchase_number || session.purchase_id}`;
    const details: string[] = [headline];
    if (summaryPayload.capturedEmail) {
      details.push(`Email: ${summaryPayload.capturedEmail}`);
    }
    if (summaryPayload.pickupTime) {
      details.push(`Pickup: ${summaryPayload.pickupTime}`);
    }
    if (summaryPayload.nextSteps?.length) {
      details.push('Next steps:');
      summaryPayload.nextSteps.forEach((step) => details.push(`- ${step}`));
    }

    return `${details.join('\n')}\n\n${JSON.stringify(summaryPayload)}`;
  }
}
