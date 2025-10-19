import { Pool, PoolClient } from 'pg';
import { SalesOrderService } from '../SalesOrderService';
import { EmailService } from '../emailService';
import { PDFService } from '../pdfService';
import { AgentTaskEvent, AgentTaskFacade } from './AgentTaskFacade';
import { VoiceService } from '../voice/VoiceService';
import { TaskInput, TaskStatus } from '../TaskService';
import { QuoteService } from '../QuoteService';
import { PurchaseOrderService } from '../PurchaseOrderService';
import DocumentEmailService from '../DocumentEmailService';

export class AgentToolsV2 {
  private soService: SalesOrderService;
  private emailService: EmailService;
  private pdfService: PDFService;
  private taskFacade: AgentTaskFacade;
  private voiceService: VoiceService;
  private quoteService: QuoteService;
  private purchaseOrderService: PurchaseOrderService;
  private documentEmailService: DocumentEmailService;
  constructor(private pool: Pool) {
    this.soService = new SalesOrderService(pool);
    this.emailService = new EmailService(pool);
    this.pdfService = new PDFService(pool);
    this.taskFacade = new AgentTaskFacade(pool);
    this.voiceService = new VoiceService(pool);
    this.quoteService = new QuoteService(pool);
    this.purchaseOrderService = new PurchaseOrderService(pool);
    this.documentEmailService = new DocumentEmailService(pool, this.emailService, this.pdfService);
  }

  private requireEmailUser(userId: number | null | undefined): number {
    if (userId === null || userId === undefined) {
      throw new Error('Authenticated user context is required for email operations');
    }

    if (typeof userId !== 'number' || !Number.isFinite(userId)) {
      throw new Error('Invalid user id provided for email operation');
    }

    return userId;
  }

  private toBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    }
    return Boolean(value);
  }

  private normalizeInvoiceStatus(value: any): 'needed' | 'done' | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      if (['needed', 'need', 'required', 'pending'].includes(normalized)) return 'needed';
      if (['done', 'complete', 'completed', 'sent'].includes(normalized)) return 'done';
      if (['true', 't', 'yes', 'y', '1', 'on'].includes(normalized)) return 'needed';
      if (['false', 'f', 'no', 'n', '0', 'off'].includes(normalized)) return null;
    }
    if (typeof value === 'boolean') return value ? 'needed' : null;
    if (typeof value === 'number') return value > 0 ? 'needed' : null;
    return null;
  }

  private normalizeAssigneeIds(value: any): number[] {
    if (value == null) {
      return [];
    }

    const source = Array.isArray(value) ? value : [value];
    const normalized = source
      .map((item) => {
        if (typeof item === 'number') {
          return Number.isFinite(item) ? item : NaN;
        }
        if (typeof item === 'string' && item.trim().length > 0) {
          const parsed = Number(item);
          return Number.isFinite(parsed) ? parsed : NaN;
        }
        return NaN;
      })
      .filter((id) => Number.isFinite(id)) as number[];

    return Array.from(new Set(normalized));
  }

  private normalizeTaskStatus(value: any): TaskStatus | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    const canonical = normalized.replace(/[\s-]+/g, '_');

    const direct: Record<string, TaskStatus> = {
      pending: 'pending',
      in_progress: 'in_progress',
      completed: 'completed',
      archived: 'archived',
    };

    if (canonical in direct) {
      return direct[canonical];
    }

    const synonymMap: Record<string, TaskStatus> = {
      todo: 'pending',
      to_do: 'pending',
      open: 'pending',
      new: 'pending',
      not_started: 'pending',
      waiting: 'pending',
      backlog: 'pending',
      started: 'in_progress',
      working: 'in_progress',
      active: 'in_progress',
      progressing: 'in_progress',
      processing: 'in_progress',
      underway: 'in_progress',
      done: 'completed',
      complete: 'completed',
      finished: 'completed',
      resolved: 'completed',
      closed: 'archived',
      archive: 'archived',
      archived_task: 'archived',
      cancelled: 'archived',
      canceled: 'archived',
    };

    if (canonical in synonymMap) {
      return synonymMap[canonical];
    }

    throw new Error(`Invalid task status: ${value}`);
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

  // Tasks
  async createAgentTask(
    sessionId: number,
    companyId: number,
    userId: number,
    payload: any
  ): Promise<AgentTaskEvent> {
    const titleSource = typeof payload?.title === 'string' && payload.title.trim().length > 0
      ? payload.title.trim()
      : typeof payload?.subject === 'string' && payload.subject.trim().length > 0
        ? payload.subject.trim()
        : 'Follow-up task';

    const status = this.normalizeTaskStatus(payload?.status);

    const taskPayload: TaskInput = {
      title: titleSource,
      description: typeof payload?.description === 'string' ? payload.description : undefined,
      status,
      dueDate:
        payload?.dueDate === null
          ? null
          : typeof payload?.dueDate === 'string'
            ? payload.dueDate
            : undefined,
      assigneeIds: this.normalizeAssigneeIds(payload?.assigneeIds ?? payload?.assignees),
      initialNote: typeof payload?.initialNote === 'string' ? payload.initialNote : undefined,
    };

    const followUp = typeof payload?.followUp === 'string' ? payload.followUp : undefined;

    try {
      const event = await this.taskFacade.createTask(sessionId, companyId, userId, {
        ...taskPayload,
        followUp,
      });
      await this.audit(sessionId, 'createTask', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      await this.audit(sessionId, 'createTask', payload, { error: error?.message ?? String(error) }, false);
      throw error;
    }
  }

  async updateAgentTask(
    sessionId: number,
    companyId: number,
    userId: number,
    payload: any
  ): Promise<AgentTaskEvent> {
    const taskId = Number(payload?.taskId ?? payload?.id);
    if (!Number.isFinite(taskId)) {
      throw new Error('Task id is required to update a task');
    }

    const updates: { status?: TaskStatus; dueDate?: string | null; note?: string } = {};
    if (typeof payload?.status === 'string' && payload.status.trim().length > 0) {
      updates.status = this.normalizeTaskStatus(payload.status);
    }
    if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'dueDate')) {
      updates.dueDate = payload?.dueDate === null ? null : typeof payload?.dueDate === 'string' ? payload.dueDate : undefined;
    }
    if (typeof payload?.note === 'string' && payload.note.trim().length > 0) {
      updates.note = payload.note.trim();
    }

    try {
      const event = await this.taskFacade.updateTask(sessionId, companyId, userId, taskId, updates);
      await this.audit(sessionId, 'updateTask', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      await this.audit(sessionId, 'updateTask', payload, { error: error?.message ?? String(error) }, false);
      throw error;
    }
  }

  async postAgentTaskMessage(
    sessionId: number,
    companyId: number,
    userId: number,
    payload: any
  ): Promise<AgentTaskEvent> {
    const taskId = Number(payload?.taskId ?? payload?.id);
    if (!Number.isFinite(taskId)) {
      throw new Error('Task id is required to post a task message');
    }

    const contentSource =
      typeof payload?.content === 'string'
        ? payload.content
        : typeof payload?.message === 'string'
          ? payload.message
          : '';

    if (!contentSource || contentSource.trim().length === 0) {
      throw new Error('Message content is required');
    }

    const reason = typeof payload?.reason === 'string' ? payload.reason : 'agent_comment';

    try {
      const event = await this.taskFacade.postMessage(
        sessionId,
        companyId,
        userId,
        taskId,
        contentSource,
        reason
      );
      await this.audit(sessionId, 'postTaskMessage', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      await this.audit(sessionId, 'postTaskMessage', payload, { error: error?.message ?? String(error) }, false);
      throw error;
    }
  }

  // Sales Orders
  async createSalesOrder(sessionId: number, payload: any) {
    try {
      const result = await this.soService.createSalesOrder(payload, { access_role: 'Admin' });
      await this.audit(sessionId, 'createSalesOrder', payload, result, true);
      return result;
    } catch (e: any) {
      await this.audit(sessionId, 'createSalesOrder', payload, { error: e.message }, false);
      throw e;
    }
  }

  async updateSalesOrder(sessionId: number, salesOrderId: number, patch: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = ['customer_id','sales_date','product_name','product_description','terms','subtotal','total_gst_amount','total_amount','status','estimated_cost','sequence_number','customer_po_number','vin_number','vehicle_make','vehicle_model','invoice_status','quote_id','source_quote_number'];
      const header = patch.header || {};
      if (Object.prototype.hasOwnProperty.call(header, 'invoice_required')) {
        header.invoice_status = this.normalizeInvoiceStatus(header.invoice_required);
        delete header.invoice_required;
      }
      if (Object.prototype.hasOwnProperty.call(header, 'invoice_status')) {
        header.invoice_status = this.normalizeInvoiceStatus(header.invoice_status);
      }
      if (Object.keys(header).length) {
        const fields:string[]=[]; const values:any[]=[]; let i=1;
        for (const [k,v] of Object.entries(header)) {
          if (allowed.includes(k) && v!==undefined && (v!==null || k === 'invoice_status')){
            const valueToUse = k === 'invoice_status' ? this.normalizeInvoiceStatus(v) : v;
            fields.push(`${k}=$${i++}`);
            values.push(valueToUse);
          }
        }
        if (fields.length){ values.push(salesOrderId); await client.query(`UPDATE salesorderhistory SET ${fields.join(', ')}, updated_at = NOW() WHERE sales_order_id = $${i}`, values); }
      }
      if (Array.isArray(patch.lineItems)) {
        await this.soService.updateSalesOrder(salesOrderId, patch.lineItems, client, { access_role: 'Admin' }); // Agent V2 has admin privileges
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
    try {
      const result = await this.purchaseOrderService.createPurchaseOrder(payload);
      await this.audit(sessionId, 'createPurchaseOrder', payload, result, true);
      return result;
    } catch (e: any) {
      await this.audit(sessionId, 'createPurchaseOrder', payload, { error: e.message }, false);
      throw e;
    }
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
          const normalized = String(item.part_number || '').trim().toUpperCase();
          const invQ = await client.query(
            `SELECT part_id FROM inventory WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
            [normalized]
          );
          const resolvedPartId = invQ.rows[0]?.part_id || null;
          await client.query(
            'INSERT INTO purchaselineitems (purchase_id, part_number, part_description, quantity, unit_cost, line_amount, unit, part_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [purchaseOrderId, item.part_number || '', item.part_description || '', Number(item.quantity || 0), Number(item.unit_cost || 0), Number(item.line_amount || 0), item.unit || 'Each', resolvedPartId]
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

  async emailPurchaseOrder(
    sessionId: number,
    purchaseId: number,
    to: string | string[],
    customMessage: string | undefined,
    userId?: number | null
  ) {
    try {
      const result = await this.documentEmailService.sendPurchaseOrderEmail(purchaseId, to, {
        customMessage,
        userId: userId ?? undefined,
      });

      if (!result.success) {
        await this.audit(sessionId, 'emailPurchaseOrder', { purchaseId, to, customMessage }, result, false);
        throw new Error(result.message || 'Failed to send purchase order email');
      }

      await this.audit(sessionId, 'emailPurchaseOrder', { purchaseId, to, customMessage }, result, true);
      return result;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'emailPurchaseOrder',
        { purchaseId, to, customMessage },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  // Quotes
  async createQuote(sessionId: number, payload: any) {
    const baseQuoteDate = payload?.quote_date ? new Date(payload.quote_date) : new Date();
    const quoteDate = Number.isNaN(baseQuoteDate.getTime()) ? new Date() : baseQuoteDate;
    const validUntilCandidate = payload?.valid_until ? new Date(payload.valid_until) : null;
    const resolvedValidUntil = validUntilCandidate && !Number.isNaN(validUntilCandidate.getTime())
      ? validUntilCandidate
      : new Date(quoteDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const quoteInput = {
      ...payload,
      quote_date: quoteDate,
      valid_until: resolvedValidUntil,
    };

    try {
      const result = await this.quoteService.createQuote(quoteInput as any);
      await this.audit(sessionId, 'createQuote', payload, result, true);
      return result;
    } catch (error: any) {
      await this.audit(sessionId, 'createQuote', payload, { error: error?.message }, false);
      throw error;
    }
  }
  async updateQuote(sessionId: number, quoteId: number, patch: any) {
    const allowed=['customer_id','quote_date','valid_until','product_name','product_description','estimated_cost','status','terms','customer_po_number','vin_number','vehicle_make','vehicle_model'];
    const fields:string[]=[]; const vals:any[]=[]; let i=1;
    for (const [k,v] of Object.entries(patch)) { if (allowed.includes(k) && v!==undefined && v!==null){ fields.push(`${k}=$${i++}`); vals.push(v);} }
    if (fields.length){ vals.push(quoteId); await this.pool.query(`UPDATE quotes SET ${fields.join(', ')}, updated_at = NOW() WHERE quote_id = $${i}`, vals); }
    const out = { updated: true };
    await this.audit(sessionId,'updateQuote',{quoteId,patch},out,true);
    return out;
  }

  async emailQuote(
    sessionId: number,
    quoteId: number,
    to: string | string[],
    userId?: number | null
  ) {
    try {
      const result = await this.documentEmailService.sendQuoteEmail(quoteId, to, { userId: userId ?? undefined });

      if (!result.success) {
        await this.audit(sessionId, 'emailQuote', { quoteId, to }, result, false);
        throw new Error(result.message || 'Failed to send quote email');
      }

      await this.audit(sessionId, 'emailQuote', { quoteId, to }, result, true);
      return result;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'emailQuote',
        { quoteId, to },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async getEmailSettings(sessionId: number, userId: number | null | undefined) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const settings = await this.emailService.getUserEmailSettings(resolvedUserId);
      const { email_pass: _password, ...safeSettings } = settings ?? {};
      const output = { settings: settings ? safeSettings : null };
      await this.audit(sessionId, 'getEmailSettings', { userId: resolvedUserId }, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'getEmailSettings',
        { userId: resolvedUserId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async saveEmailSettings(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const emailHost = typeof payload?.email_host === 'string' ? payload.email_host.trim() : '';
      const emailPortRaw = payload?.email_port;
      const emailUser = typeof payload?.email_user === 'string' ? payload.email_user.trim() : '';

      if (!emailHost || !emailUser || emailPortRaw === undefined) {
        throw new Error('email_host, email_port, and email_user are required to save email settings');
      }

      const emailPort = Number(emailPortRaw);
      if (!Number.isFinite(emailPort)) {
        throw new Error('email_port must be a valid number');
      }

      const emailSecureSource = payload?.email_secure;
      const emailSecure =
        emailSecureSource === true ||
        emailSecureSource === 'true' ||
        emailSecureSource === 1 ||
        emailSecureSource === '1';

      const success = await this.emailService.saveUserEmailSettings(resolvedUserId, {
        email_provider:
          typeof payload?.email_provider === 'string' && payload.email_provider.trim().length > 0
            ? payload.email_provider.trim()
            : 'custom',
        email_host: emailHost,
        email_port: emailPort,
        email_secure: emailSecure,
        email_user: emailUser,
        email_pass: typeof payload?.email_pass === 'string' && payload.email_pass.trim().length > 0
          ? payload.email_pass
          : undefined,
        email_from: typeof payload?.email_from === 'string' && payload.email_from.trim().length > 0
          ? payload.email_from.trim()
          : undefined,
      });

      const output = {
        success,
        message: success
          ? 'Email settings saved successfully'
          : 'Failed to save email settings',
      };

      await this.audit(sessionId, 'saveEmailSettings', { userId: resolvedUserId, payload }, output, success);

      if (!success) {
        throw new Error(output.message);
      }

      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'saveEmailSettings',
        { userId: resolvedUserId, payload },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async testEmailConnection(sessionId: number, userId: number | null | undefined) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const success = await this.emailService.testUserEmailConnection(resolvedUserId);
      const output = {
        success,
        message: success
          ? 'Email connection test successful'
          : 'Email connection test failed',
      };
      await this.audit(sessionId, 'testEmailConnection', { userId: resolvedUserId }, output, success);
      if (!success) {
        throw new Error(output.message);
      }
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'testEmailConnection',
        { userId: resolvedUserId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async listEmailTemplates(sessionId: number, userId: number | null | undefined) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const templates = await this.emailService.getUserEmailTemplates(resolvedUserId);
      const output = { templates };
      await this.audit(sessionId, 'listEmailTemplates', { userId: resolvedUserId }, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'listEmailTemplates',
        { userId: resolvedUserId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async getEmailTemplate(
    sessionId: number,
    userId: number | null | undefined,
    templateId: number
  ) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const template = await this.emailService.getEmailTemplate(templateId, resolvedUserId);
      if (!template) {
        throw new Error('Email template not found');
      }
      await this.audit(
        sessionId,
        'getEmailTemplate',
        { userId: resolvedUserId, templateId },
        { template },
        true
      );
      return { template };
    } catch (error: any) {
      await this.audit(
        sessionId,
        'getEmailTemplate',
        { userId: resolvedUserId, templateId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async saveEmailTemplate(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const templateIdRaw = payload?.template_id ?? payload?.id;
    const templateId = Number(templateIdRaw);

    const hasTemplateId = Number.isFinite(templateId);

    try {
      const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
      const subject = typeof payload?.subject === 'string' ? payload.subject.trim() : '';
      const htmlContent = typeof payload?.html_content === 'string' ? payload.html_content : '';

      if (!name || !subject || !htmlContent) {
        throw new Error('name, subject, and html_content are required for email templates');
      }

      const textContent = typeof payload?.text_content === 'string' ? payload.text_content : undefined;
      const isDefault =
        payload?.is_default === true ||
        payload?.is_default === 'true' ||
        payload?.is_default === 1 ||
        payload?.is_default === '1';

      if (hasTemplateId) {
        const success = await this.emailService.updateEmailTemplate(templateId, resolvedUserId, {
          name,
          subject,
          html_content: htmlContent,
          text_content: textContent,
          is_default: isDefault,
        });

        const output = {
          success,
          templateId,
          message: success
            ? 'Email template updated successfully'
            : 'Template not found or update failed',
        };

        await this.audit(
          sessionId,
          'saveEmailTemplate',
          { userId: resolvedUserId, payload },
          output,
          success
        );

        if (!success) {
          throw new Error(output.message);
        }

        return output;
      }

      const type = typeof payload?.type === 'string' ? payload.type.trim() : '';
      if (!type) {
        throw new Error('type is required when creating a new email template');
      }

      const createdId = await this.emailService.createEmailTemplate(resolvedUserId, {
        name,
        type: type as any,
        subject,
        html_content: htmlContent,
        text_content: textContent,
        is_default: isDefault,
      });

      const output = {
        success: true,
        templateId: createdId,
        message: 'Email template created successfully',
      };

      await this.audit(sessionId, 'saveEmailTemplate', { userId: resolvedUserId, payload }, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'saveEmailTemplate',
        { userId: resolvedUserId, payload },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async deleteEmailTemplate(
    sessionId: number,
    userId: number | null | undefined,
    templateId: number
  ) {
    const resolvedUserId = this.requireEmailUser(userId);
    try {
      const success = await this.emailService.deleteEmailTemplate(templateId, resolvedUserId);
      const output = {
        success,
        message: success
          ? 'Email template deleted successfully'
          : 'Template not found or delete failed',
      };
      await this.audit(
        sessionId,
        'deleteEmailTemplate',
        { userId: resolvedUserId, templateId },
        output,
        success
      );
      if (!success) {
        throw new Error(output.message);
      }
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'deleteEmailTemplate',
        { userId: resolvedUserId, templateId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
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
      vehicle_make: quote.vehicle_make,
      vehicle_model: quote.vehicle_model,
      subtotal: quote.estimated_cost,
      total_gst_amount: Number(quote.estimated_cost||0)*0.05,
      total_amount: Number(quote.estimated_cost||0)*1.05,
      status: 'Open',
      quote_id: quote.quote_id,
      source_quote_number: quote.quote_number
    }, lineItems: [] });
    await this.audit(sessionId,'convertQuoteToSO',{quoteId},so,true);
    return so;
  }

  // Voice call management
  async initiateVendorCall(sessionId: number, purchaseId: number) {
    try {
      const session = await this.voiceService.initiateVendorCall(purchaseId, { agentSessionId: sessionId });
      const payload = {
        message: `Initiated vendor call for PO ${session.purchase_number || purchaseId}.`,
        session,
      };
      await this.audit(sessionId, 'initiateVendorCall', { purchaseId }, payload, true);
      return payload;
    } catch (error: any) {
      await this.audit(sessionId, 'initiateVendorCall', { purchaseId }, { error: error.message }, false);
      throw error;
    }
  }

  async pollVendorCall(sessionId: number, callSessionId: number) {
    try {
      const session = await this.voiceService.getSession(callSessionId, { includeEvents: true });
      const payload = {
        message: `Vendor call status: ${session.status}`,
        session,
      };
      await this.audit(sessionId, 'pollVendorCall', { callSessionId }, payload, true);
      return payload;
    } catch (error: any) {
      await this.audit(sessionId, 'pollVendorCall', { callSessionId }, { error: error.message }, false);
      throw error;
    }
  }

  async sendVendorCallEmail(sessionId: number, callSessionId: number, overrideEmail?: string) {
    try {
      const result = await this.voiceService.sendPurchaseOrderEmail(callSessionId, overrideEmail);
      await this.audit(
        sessionId,
        'sendVendorCallEmail',
        { callSessionId, overrideEmail },
        result,
        true
      );
      return result;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'sendVendorCallEmail',
        { callSessionId, overrideEmail },
        { error: error.message },
        false
      );
      throw error;
    }
  }
}


