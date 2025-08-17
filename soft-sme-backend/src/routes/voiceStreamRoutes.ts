import express from 'express';
import { GeminiLiveBridge } from '../services/voice/GeminiLiveBridge';
import { pool } from '../db';

const router = express.Router();

// WebSocket endpoint for Twilio Media Streams
// This will be handled by the main app's express-ws instance
router.get('/stream', (req, res) => {
  // This is a placeholder - the actual WebSocket handling is done in index.ts
  res.status(400).json({ error: 'WebSocket endpoint - use ws:// protocol' });
});

// Handle Gemini function calls
async function handleGeminiFunctionCall(sessionId: string, functionCall: any) {
  try {
    const { name, args } = functionCall;

    switch (name) {
      case 'set_pickup_time':
        await updateCallSession(sessionId, {
          pickup_time: args.pickup_time,
          pickup_location: args.pickup_location,
          pickup_contact_person: args.pickup_contact_person,
          pickup_phone: args.pickup_phone,
          pickup_instructions: args.pickup_instructions
        });
        // Also update the purchase order with pickup details
        await updatePurchaseOrderPickupDetails(sessionId, args);
        break;
      case 'set_vendor_email':
        await updateCallSession(sessionId, { captured_email: args.email });
        break;
      case 'order_part':
        await updateCallSession(sessionId, {
          parts_ordered: args.parts,
          order_details: args.details
        });
        break;
      case 'send_po_pdf':
        await updateCallSession(sessionId, { po_email_sent: true });
        break;
      default:
        console.log(`Unknown function call: ${name}`);
    }
  } catch (error) {
    console.error('Error handling Gemini function call:', error);
  }
}

async function updateCallSession(sessionId: string, updates: any) {
  try {
    await pool.query(
      'UPDATE vendor_call_sessions SET updated_at = NOW() WHERE id = $1',
      [sessionId]
    );
    console.log(`Updated call session ${sessionId}`);
  } catch (error) {
    console.error('Error updating call session:', error);
  }
}

async function updatePurchaseOrderPickupDetails(sessionId: string, pickupDetails: any) {
  try {
    // Get the purchase_id from the call session
    const sessionResult = await pool.query(
      'SELECT purchase_id FROM vendor_call_sessions WHERE id = $1',
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      console.error('Call session not found for pickup details update');
      return;
    }

    const purchaseId = sessionResult.rows[0].purchase_id;

    // Update the purchase order with pickup details
    await pool.query(`
      UPDATE purchasehistory
      SET
        pickup_time = $1,
        pickup_location = $2,
        pickup_contact_person = $3,
        pickup_phone = $4,
        pickup_instructions = $5,
        updated_at = NOW()
      WHERE purchase_id = $6
    `, [
      pickupDetails.pickup_time || null,
      pickupDetails.pickup_location || null,
      pickupDetails.pickup_contact_person || null,
      pickupDetails.pickup_phone || null,
      pickupDetails.pickup_instructions || null,
      purchaseId
    ]);

    console.log(`Updated purchase order ${purchaseId} with pickup details`);
  } catch (error) {
    console.error('Error updating purchase order pickup details:', error);
  }
}

export default router;


