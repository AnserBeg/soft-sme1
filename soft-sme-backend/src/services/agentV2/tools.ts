import { Pool } from 'pg';
import { SalesOrderService } from '../SalesOrderService';
import { EmailService } from '../emailService';
import { PDFService } from '../pdfService';

export class AgentToolsV2 {
  private soService: SalesOrderService;
  private emailService: EmailService;
  private pdfService: PDFService;
  constructor(private pool: Pool) {
    this.soService = new SalesOrderService(pool);
    this.emailService = new EmailService(pool);
    this.pdfService = new PDFService(pool);
  }

  // Utility to audit tool execution
  private async audit(sessionId: number, tool: string, input: any, output: any, success = true) {
    await this.pool.query(
      'INSERT INTO agent_tool_invocations (session_id, tool, input, output, success) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, tool, input ? JSON.stringify(input) : null, output ? JSON.stringify(output) : null, success]
    );
  }

  // RAG: simple keyword search over agent_docs for now
  async retrieveDocs(query: string, k = 5) {
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    if (terms.length === 0) return [];
    const like = terms.map((_, i) => `chunk ILIKE $${i + 1}`).join(' OR ');
    const params = terms.map(t => `%${t}%`);
    const res = await this.pool.query(`SELECT path, section, chunk FROM agent_docs WHERE ${like} LIMIT ${k}`, params);
    return res.rows;
  }

  // Sales Orders
  async createSalesOrder(sessionId: number, payload: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();
      const year = now.getFullYear();
      const seqRes = await client.query(`SELECT COALESCE(MAX(sequence_number),0)+1 as seq FROM salesorderhistory WHERE EXTRACT(YEAR FROM sales_date)= $1`, [year]);
      const seq = parseInt(seqRes.rows[0].seq) || 1;
      const soNum = `SO-${year}-${String(seq).padStart(5, '0')}`;
      const header = payload.header || {};
      const subtotal = Number(header.subtotal || 0);
      const gst = Number(header.total_gst_amount || (subtotal * 0.05));
      const total = Number(header.total_amount || (subtotal + gst));
      const insert = await client.query(
        `INSERT INTO salesorderhistory (sales_order_number, customer_id, sales_date, product_name, product_description, terms, customer_po_number, vin_number, subtotal, total_gst_amount, total_amount, status, estimated_cost, sequence_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING sales_order_id` ,
        [soNum, header.customer_id || null, header.sales_date || now, header.product_name || '', header.product_description || '', header.terms || '', header.customer_po_number || '', header.vin_number || '', subtotal, gst, total, header.status || 'Open', Number(header.estimated_cost || 0), seq]
      );
      const soId = insert.rows[0].sales_order_id;
      const lines = Array.isArray(payload.lineItems) ? payload.lineItems : [];
      for (const item of lines) {
        await this.soService.upsertLineItem(soId, item, client);
      }
      await this.soService.recalculateAndUpdateSummary(soId, client);
      await client.query('COMMIT');
      const out = { sales_order_id: soId, sales_order_number: soNum };
      await this.audit(sessionId, 'createSalesOrder', payload, out, true);
      return out;
    } catch (e:any) {
      await client.query('ROLLBACK');
      await this.audit(sessionId, 'createSalesOrder', payload, { error: e.message }, false);
      throw e;
    } finally { client.release(); }
  }

  async updateSalesOrder(sessionId: number, salesOrderId: number, patch: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = ['customer_id','sales_date','product_name','product_description','terms','subtotal','total_gst_amount','total_amount','status','estimated_cost','sequence_number','customer_po_number','vin_number'];
      const header = patch.header || {};
      if (Object.keys(header).length) {
        const fields:string[]=[]; const values:any[]=[]; let i=1;
        for (const [k,v] of Object.entries(header)) { if (allowed.includes(k) && v!==undefined && v!==null){ fields.push(`${k}=$${i++}`); values.push(v);} }
        if (fields.length){ values.push(salesOrderId); await client.query(`UPDATE salesorderhistory SET ${fields.join(', ')}, updated_at = NOW() WHERE sales_order_id = $${i}`, values); }
      }
      if (Array.isArray(patch.lineItems)) {
        await this.soService.updateSalesOrder(salesOrderId, patch.lineItems, client);
      }
      if (Array.isArray(patch.partsToOrder)) {
        for (const p of patch.partsToOrder) {
          await client.query('DELETE FROM sales_order_parts_to_order WHERE sales_order_id=$1 AND part_number=$2', [salesOrderId, p.part_number]);
          await client.query('INSERT INTO sales_order_parts_to_order (sales_order_id, part_number, part_description, quantity_needed, unit, unit_price, line_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [salesOrderId, p.part_number, p.part_description||'', Number(p.quantity_needed||0), p.unit||'Each', Number(p.unit_price||0), Number(p.line_amount||0)]);
        }
      }
      await this.soService.recalculateAndUpdateSummary(salesOrderId, client);
      if (header.status){
        const stRes = await client.query('SELECT status FROM salesorderhistory WHERE sales_order_id=$1',[salesOrderId]);
        const curr = stRes.rows[0]?.status;
        if (header.status==='Closed' && curr!=='Closed') await this.soService.closeOrder(salesOrderId, client);
        if (header.status==='Open' && curr==='Closed') await this.soService.openOrder(salesOrderId, client);
      }
      await client.query('COMMIT');
      const out = { updated: true };
      await this.audit(sessionId, 'updateSalesOrder', { salesOrderId, patch }, out, true);
      return out;
    } catch(e:any){
      await client.query('ROLLBACK');
      await this.audit(sessionId, 'updateSalesOrder', { salesOrderId, patch }, { error: e.message }, false);
      throw e;
    } finally { client.release(); }
  }

  // Purchase Orders
  async createPurchaseOrder(sessionId: number, payload: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();
      const year = now.getFullYear();
      const seqRes = await client.query(`SELECT COALESCE(MAX(sequence_number),0)+1 as seq FROM purchasehistory WHERE EXTRACT(YEAR FROM purchase_date)= $1`, [year]);
      const seq = parseInt(seqRes.rows[0].seq) || 1;
      const poNum = `PO-${year}-${String(seq).padStart(5, '0')}`;
      const header = payload.header || {};
      const subtotal = Number(header.subtotal || 0);
      const gst = Number(header.total_gst_amount || (subtotal * 0.05));
      const total = Number(header.total_amount || (subtotal + gst));
      const insert = await client.query(
        `INSERT INTO purchasehistory (purchase_number, vendor_id, purchase_date, subtotal, total_gst_amount, total_amount, status, sequence_number, pickup_notes, pickup_time, pickup_location, pickup_contact_person, pickup_phone, pickup_instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING purchase_id` ,
        [poNum, header.vendor_id || null, header.purchase_date || now, subtotal, gst, total, header.status || 'Open', seq, header.pickup_notes || null, header.pickup_time || null, header.pickup_location || null, header.pickup_contact_person || null, header.pickup_phone || null, header.pickup_instructions || null]
      );
      const poId = insert.rows[0].purchase_id;
      const lines = Array.isArray(payload.lineItems) ? payload.lineItems : [];
      for (const item of lines) {
        await client.query(
          'INSERT INTO purchaselineitems (purchase_id, part_number, part_description, quantity, unit_cost, line_amount, unit) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [poId, item.part_number || '', item.part_description || '', Number(item.quantity || 0), Number(item.unit_cost || 0), Number(item.line_amount || 0), item.unit || 'Each']
        );
      }
      await client.query('COMMIT');
      const out = { purchase_id: poId, purchase_number: poNum };
      await this.audit(sessionId, 'createPurchaseOrder', payload, out, true);
      return out;
    } catch (e:any) {
      await client.query('ROLLBACK');
      await this.audit(sessionId, 'createPurchaseOrder', payload, { error: e.message }, false);
      throw e;
    } finally { client.release(); }
  }

  async updatePurchaseOrder(sessionId: number, purchaseOrderId: number, patch: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = ['vendor_id','purchase_date','subtotal','total_gst_amount','total_amount','status','sequence_number','pickup_notes','pickup_time','pickup_location','pickup_contact_person','pickup_phone','pickup_instructions'];
      const header = patch.header || {};
      if (Object.keys(header).length) {
        const fields:string[]=[]; const values:any[]=[]; let i=1;
        for (const [k,v] of Object.entries(header)) { if (allowed.includes(k) && v!==undefined && v!==null){ fields.push(`${k}=$${i++}`); values.push(v);} }
        if (fields.length){ values.push(purchaseOrderId); await client.query(`UPDATE purchasehistory SET ${fields.join(', ')}, updated_at = NOW() WHERE purchase_id = $${i}`, values); }
      }
      if (Array.isArray(patch.lineItems)) {
        // Clear existing line items and add new ones
        await client.query('DELETE FROM purchaselineitems WHERE purchase_id = $1', [purchaseOrderId]);
        for (const item of patch.lineItems) {
          await client.query(
            'INSERT INTO purchaselineitems (purchase_id, part_number, part_description, quantity, unit_cost, line_amount, unit) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [purchaseOrderId, item.part_number || '', item.part_description || '', Number(item.quantity || 0), Number(item.unit_cost || 0), Number(item.line_amount || 0), item.unit || 'Each']
          );
        }
      }
      await client.query('COMMIT');
      const out = { updated: true };
      await this.audit(sessionId, 'updatePurchaseOrder', { purchaseOrderId, patch }, out, true);
      return out;
    } catch (e:any) {
      await client.query('ROLLBACK');
      await this.audit(sessionId, 'updatePurchaseOrder', { purchaseOrderId, patch }, { error: e.message }, false);
      throw e;
    } finally { client.release(); }
  }

  // Pickup Management Tools
  async updatePickupDetails(sessionId: number, purchaseOrderId: number, pickupDetails: any) {
    try {
      const allowed = ['pickup_notes','pickup_time','pickup_location','pickup_contact_person','pickup_phone','pickup_instructions'];
      const fields:string[]=[]; const values:any[]=[]; let i=1;
      for (const [k,v] of Object.entries(pickupDetails)) { 
        if (allowed.includes(k) && v!==undefined && v!==null){ 
          fields.push(`${k}=$${i++}`); 
          values.push(v);
        } 
      }
      
      if (fields.length) {
        values.push(purchaseOrderId);
        await this.pool.query(
          `UPDATE purchasehistory SET ${fields.join(', ')}, updated_at = NOW() WHERE purchase_id = $${i}`,
          values
        );
        
        const out = { updated: true, fields: fields };
        await this.audit(sessionId, 'updatePickupDetails', { purchaseOrderId, pickupDetails }, out, true);
        return out;
      }
      
      return { updated: false, message: 'No valid pickup fields to update' };
    } catch (e:any) {
      await this.audit(sessionId, 'updatePickupDetails', { purchaseOrderId, pickupDetails }, { error: e.message }, false);
      throw e;
    }
  }

  async getPickupDetails(sessionId: number, purchaseOrderId: number) {
    try {
      const result = await this.pool.query(
        `SELECT pickup_notes, pickup_time, pickup_location, pickup_contact_person, pickup_phone, pickup_instructions 
         FROM purchasehistory WHERE purchase_id = $1`,
        [purchaseOrderId]
      );
      
      if (result.rows.length === 0) {
        return { error: 'Purchase order not found' };
      }
      
      const pickupDetails = result.rows[0];
      await this.audit(sessionId, 'getPickupDetails', { purchaseOrderId }, pickupDetails, true);
      return pickupDetails;
    } catch (e:any) {
      await this.audit(sessionId, 'getPickupDetails', { purchaseOrderId }, { error: e.message }, false);
      throw e;
    }
  }

  async closePurchaseOrder(sessionId: number, purchaseId: number) {
    const out = await this.updatePurchaseOrder(sessionId, purchaseId, { header: { status: 'Closed' } });
    return out;
  }

  async emailPurchaseOrder(sessionId: number, purchaseId: number, to: string, customMessage?: string) {
    const userId = undefined; // optionally pass authenticated user id
    const pdfBuffer = await this.pdfService.generatePurchaseOrderPDF(purchaseId);
    const template = this.emailService.getPurchaseOrderEmailTemplate({ purchaseOrderNumber: String(purchaseId), vendorName: '', totalAmount: 0, items: [], customMessage });
    const success = await this.emailService.sendEmail({ to, subject: template.subject, html: template.html, text: template.text, attachments:[{ filename:`purchase_order_${purchaseId}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]}, userId);
    await this.audit(sessionId,'emailPurchaseOrder',{purchaseId,to,customMessage},{success},success);
    return { success };
  }

  // Quotes
  async createQuote(sessionId: number, payload: any) {
    const res = await this.pool.query(`INSERT INTO quotes (customer_id, quote_number, quote_date, valid_until, product_name, product_description, estimated_cost, status, terms, customer_po_number, vin_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING quote_id`,
      [payload.customer_id||null, payload.quote_number||null, payload.quote_date||new Date(), payload.valid_until||new Date(), payload.product_name||'', payload.product_description||'', Number(payload.estimated_cost||0), payload.status||'Open', payload.terms||'', payload.customer_po_number||'', payload.vin_number||'']);
    const out = { quote_id: res.rows[0].quote_id };
    await this.audit(sessionId,'createQuote',payload,out,true);
    return out;
  }

  async updateQuote(sessionId: number, quoteId: number, patch: any) {
    const allowed=['customer_id','quote_date','valid_until','product_name','product_description','estimated_cost','status','terms','customer_po_number','vin_number'];
    const fields:string[]=[]; const vals:any[]=[]; let i=1;
    for (const [k,v] of Object.entries(patch)) { if (allowed.includes(k) && v!==undefined && v!==null){ fields.push(`${k}=$${i++}`); vals.push(v);} }
    if (fields.length){ vals.push(quoteId); await this.pool.query(`UPDATE quotes SET ${fields.join(', ')}, updated_at = NOW() WHERE quote_id = $${i}`, vals); }
    const out = { updated: true };
    await this.audit(sessionId,'updateQuote',{quoteId,patch},out,true);
    return out;
  }

  async emailQuote(sessionId: number, quoteId: number, to: string) {
    const pdfBuffer = await this.pdfService.generateQuotePDF(quoteId);
    const template = this.emailService.getQuoteEmailTemplate({ quoteNumber: String(quoteId), customerName:'', productName:'', productDescription:'', estimatedCost:0, validUntil: new Date().toLocaleDateString() });
    const success = await this.emailService.sendEmail({ to, subject: template.subject, html: template.html, text: template.text, attachments:[{ filename:`quote_${quoteId}.pdf`, content: pdfBuffer, contentType:'application/pdf' }]}, undefined);
    await this.audit(sessionId,'emailQuote',{quoteId,to},{success},success);
    return { success };
  }

  async convertQuoteToSO(sessionId: number, quoteId: number) {
    // Simple conversion: fetch quote, create SO header from it
    const q = await this.pool.query('SELECT * FROM quotes WHERE quote_id=$1',[quoteId]);
    if (q.rows.length===0) throw new Error('Quote not found');
    const quote = q.rows[0];
    const so = await this.createSalesOrder(sessionId, { header: {
      customer_id: quote.customer_id,
      sales_date: quote.quote_date,
      product_name: quote.product_name,
      product_description: quote.product_description,
      terms: quote.terms,
      customer_po_number: quote.customer_po_number,
      vin_number: quote.vin_number,
      subtotal: quote.estimated_cost,
      total_gst_amount: Number(quote.estimated_cost||0)*0.05,
      total_amount: Number(quote.estimated_cost||0)*1.05,
      status: 'Open'
    }, lineItems: [] });
    await this.audit(sessionId,'convertQuoteToSO',{quoteId},so,true);
    return so;
  }
}


