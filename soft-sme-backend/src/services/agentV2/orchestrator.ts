import { Pool } from 'pg';

export interface AgentToolRegistry {
  [name: string]: (args: any) => Promise<any>;
}

interface VoiceVendorInfo {
  id?: number;
  name?: string | null;
  phone?: string | null;
}

interface VoiceCallArtifact {
  type: 'vendor_call_summary';
  sessionId: number;
  status: string;
  purchaseId?: number;
  purchaseNumber?: string | null;
  vendor?: VoiceVendorInfo;
  capturedEmail?: string | null;
  pickupTime?: string | null;
  parts?: Array<{ part_number: string; quantity: number; notes?: string | null }>;
  summary?: string | null;
  nextSteps?: string[];
  transcriptPreview?: string | null;
}

interface AgentEventBase {
  timestamp?: string;
}

export type AgentEvent =
  | ({ type: 'text'; content: string; callArtifacts?: VoiceCallArtifact[] } & AgentEventBase)
  | ({ type: 'docs'; info: string; chunks: any[] } & AgentEventBase)
  | ({ type: 'task_created' | 'task_updated' | 'task_message'; summary: string; task: any; link: string } & AgentEventBase);

export interface AgentResponse {
  events: AgentEvent[];
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  example?: string;
}

export class AgentOrchestratorV2 {
  private readonly toolCatalog: ToolCatalogEntry[];

  constructor(private pool: Pool, private tools: AgentToolRegistry) {
    this.toolCatalog = this.buildToolCatalog();
  }

  getToolCatalog(): ToolCatalogEntry[] {
    return this.toolCatalog;
  }

  async handleMessage(
    sessionId: number,
    message: string,
    _context?: { companyId?: number | null; userId?: number | null }
  ): Promise<AgentResponse> {
    const events: AgentEvent[] = [];
    const intent = this.classifyIntent(message);

    if (intent && this.tools[intent.tool]) {
      try {
        const result = await this.tools[intent.tool](intent.args);
        events.push(...this.normalizeToolResult(intent.tool, result));
      } catch (error: any) {
        events.push({
          type: 'text',
          content: this.describeActionOutcome(intent.tool, false, undefined, error),
          timestamp: new Date().toISOString(),
        });
      }
    } else if (this.tools['retrieveDocs']) {
      try {
        const result = await this.tools['retrieveDocs']({ query: message });
        events.push({
          type: 'docs',
          info: 'Relevant docs',
          chunks: Array.isArray(result) ? result : [],
          timestamp: new Date().toISOString(),
        });
      } catch (error: any) {
        events.push({
          type: 'text',
          content: 'Unable to search documentation at the moment.',
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (events.length === 0) {
      events.push({
        type: 'text',
        content: 'I can help with sales orders, purchase orders, quotes, vendor calls, and tasks. What would you like to do?',
        timestamp: new Date().toISOString(),
      });
    }

    return { events };
  }

  private normalizeToolResult(tool: string, result: any): AgentEvent[] {
    const timestamp = new Date().toISOString();

    if (tool === 'retrieveDocs') {
      return [
        {
          type: 'docs',
          info: 'Relevant docs',
          chunks: Array.isArray(result) ? result : [],
          timestamp,
        },
      ];
    }

    if (result && typeof result === 'object' && result.task && result.summary) {
      const type = result.type ?? 'task_updated';
      const link = result.link ?? (result.task?.id ? `/tasks/${result.task.id}` : '');
      return [
        {
          type,
          summary: result.summary,
          task: result.task,
          link,
          timestamp,
        },
      ];
    }

    const artifact = result && typeof result === 'object' ? this.buildVoiceArtifact(result.session) : null;

    return [
      {
        type: 'text',
        content: this.extractMessage(tool, result),
        timestamp,
        ...(artifact ? { callArtifacts: [artifact] } : {}),
      },
    ];
  }

  private extractMessage(tool: string, result: any): string {
    if (result && typeof result.message === 'string' && result.message.trim().length > 0) {
      return result.message;
    }
    return this.describeActionOutcome(tool, true, result);
  }

  private buildVoiceArtifact(session: any): VoiceCallArtifact | null {
    if (!session || typeof session !== 'object') {
      return null;
    }

    const structured = session.structured_notes ?? {};
    const partsSource = Array.isArray(structured.parts) ? structured.parts : [];
    const parts = partsSource
      .map((part: any) => ({
        part_number: String(part?.part_number ?? '').trim(),
        quantity: Number(part?.quantity ?? 0) || 0,
        notes: part?.notes ?? null,
      }))
      .filter((part: any) => part.part_number.length > 0);

    const artifact: VoiceCallArtifact = {
      type: 'vendor_call_summary',
      sessionId: Number(session.id),
      status: String(session.status ?? 'unknown'),
      purchaseId: session.purchase_id != null ? Number(session.purchase_id) : undefined,
      purchaseNumber: session.purchase_number ?? null,
      vendor:
        session.vendor_id || session.vendor_name || session.vendor_phone
          ? {
              id: session.vendor_id != null ? Number(session.vendor_id) : undefined,
              name: session.vendor_name ?? null,
              phone: session.vendor_phone ?? null,
            }
          : undefined,
      capturedEmail: session.captured_email ?? structured.email ?? null,
      pickupTime: session.pickup_time ?? structured.pickup_time ?? null,
      parts: parts.length ? parts : undefined,
      summary: structured.summary ?? null,
      nextSteps: Array.isArray(structured.next_steps) ? structured.next_steps : undefined,
      transcriptPreview:
        typeof session.transcript === 'string' && session.transcript.length > 0
          ? session.transcript.slice(0, 600)
          : undefined,
    };

    return artifact;
  }

  private classifyIntent(message: string): { tool: string; args: any } | null {
    const m = message.toLowerCase();
    if (m.includes('create') && m.includes('sales order')) return { tool: 'createSalesOrder', args: {} };
    if (m.includes('update') && m.includes('sales order')) return { tool: 'updateSalesOrder', args: {} };
    if (m.includes('create') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'createPurchaseOrder', args: {} };
    if (m.includes('update') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'updatePurchaseOrder', args: {} };
    if ((m.includes('close') || m.includes('complete')) && (m.includes('purchase order') || m.includes('po')))
      return { tool: 'closePurchaseOrder', args: {} };
    if (m.includes('email') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'emailPurchaseOrder', args: {} };
    if (m.includes('call') && m.includes('vendor')) return { tool: 'initiateVendorCall', args: {} };
    if ((m.includes('call') && m.includes('status')) || m.includes('call update')) return { tool: 'pollVendorCall', args: {} };
    if (m.includes('send') && m.includes('po') && m.includes('email') && m.includes('call'))
      return { tool: 'sendVendorCallEmail', args: {} };
    if (m.includes('create') && m.includes('quote')) return { tool: 'createQuote', args: {} };
    if (m.includes('update') && m.includes('quote')) return { tool: 'updateQuote', args: {} };
    if (m.includes('email') && m.includes('quote')) return { tool: 'emailQuote', args: {} };
    if (m.includes('convert') && m.includes('quote') && (m.includes('sales order') || m.includes('so')))
      return { tool: 'convertQuoteToSO', args: {} };

    if (m.includes('pickup') && m.includes('time')) return { tool: 'updatePickupDetails', args: { pickup_time: message } };
    if (m.includes('pickup') && m.includes('location'))
      return { tool: 'updatePickupDetails', args: { pickup_location: message } };
    if (m.includes('pickup') && m.includes('contact'))
      return { tool: 'updatePickupDetails', args: { pickup_contact_person: message } };
    if (m.includes('pickup') && m.includes('phone')) return { tool: 'updatePickupDetails', args: { pickup_phone: message } };
    if (m.includes('pickup') && m.includes('instructions'))
      return { tool: 'updatePickupDetails', args: { pickup_instructions: message } };
    if (m.includes('pickup') && m.includes('notes')) return { tool: 'updatePickupDetails', args: { pickup_notes: message } };
    if (m.includes('get') && m.includes('pickup')) return { tool: 'getPickupDetails', args: {} };

    if (m.includes('doc') || m.includes('how do i')) return { tool: 'retrieveDocs', args: { query: message } };

    const reminderKeywords = ['remind', 'reminder', 'follow up', 'follow-up', 'todo', 'to-do', 'task for me', 'keep an eye'];
    if (reminderKeywords.some((keyword) => m.includes(keyword))) {
      return {
        tool: 'createTask',
        args: {
          title: message,
          description: message,
        },
      };
    }

    return null;
  }

  private buildToolCatalog(): ToolCatalogEntry[] {
    return [
      { name: 'createSalesOrder', description: 'Create a new sales order from customer information and line items.' },
      { name: 'updateSalesOrder', description: 'Update an existing sales order header, line items, or related details.' },
      { name: 'createPurchaseOrder', description: 'Create a purchase order for a vendor including pickup details and items.' },
      { name: 'updatePurchaseOrder', description: 'Update purchase order fields, pickup instructions, or line items.' },
      { name: 'closePurchaseOrder', description: 'Mark a purchase order as complete and close it out.' },
      { name: 'emailPurchaseOrder', description: 'Email a purchase order PDF to a vendor contact.' },
      { name: 'createQuote', description: 'Create a new quote for a customer.' },
      { name: 'updateQuote', description: 'Modify quote details, pricing, or line items.' },
      { name: 'emailQuote', description: 'Email a quote PDF to a customer contact.' },
      { name: 'convertQuoteToSO', description: 'Convert an existing quote into a sales order.' },
      { name: 'updatePickupDetails', description: 'Update pickup instructions such as time, location, or contact details.' },
      { name: 'getPickupDetails', description: 'Retrieve the current pickup instructions for a purchase order.' },
      { name: 'initiateVendorCall', description: 'Start an outbound vendor call to confirm parts or pickup details.' },
      { name: 'pollVendorCall', description: 'Check the latest status for an active vendor call session.' },
      { name: 'sendVendorCallEmail', description: 'Email the purchase order to the vendor after a call completes.' },
      { name: 'createTask', description: 'Create a Workspace Copilot task and subscribe the current session to updates.' },
      { name: 'updateTask', description: 'Update the status or due date of an existing task.' },
      { name: 'postTaskMessage', description: 'Post an update in the related task conversation.' },
      { name: 'retrieveDocs', description: 'Search internal documentation for workflows and UI guidance.' },
    ];
  }

  private describeActionOutcome(tool: string, success: boolean, output?: any, error?: any): string {
    if (!success) {
      const errorMsg = error instanceof Error ? error.message : String(error || 'Unknown error');
      return `Failed to ${this.describeTool(tool)}: ${errorMsg}`;
    }

    switch (tool) {
      case 'createPurchaseOrder':
        return output?.purchase_number ? `Created purchase order ${output.purchase_number}.` : 'Purchase order created successfully.';
      case 'updatePurchaseOrder':
        return 'Updated the purchase order successfully.';
      case 'closePurchaseOrder':
        return 'Closed the purchase order successfully.';
      case 'emailPurchaseOrder':
        if (output?.emailed_to && output?.purchase_number) {
          return `Sent purchase order ${output.purchase_number} to ${output.emailed_to}.`;
        }
        return 'Sent the purchase order email successfully.';
      case 'createSalesOrder':
        return output?.sales_order_number ? `Created sales order ${output.sales_order_number}.` : 'Sales order created successfully.';
      case 'updateSalesOrder':
        return 'Updated the sales order successfully.';
      case 'createQuote':
        return output?.quote_number ? `Created quote ${output.quote_number}.` : 'Quote created successfully.';
      case 'updateQuote':
        return 'Updated the quote successfully.';
      case 'emailQuote':
        return 'Sent the quote email successfully.';
      case 'convertQuoteToSO':
        return 'Converted the quote into a sales order successfully.';
      case 'updatePickupDetails':
        return 'Updated pickup details successfully.';
      case 'getPickupDetails':
        return 'Retrieved pickup details successfully.';
      case 'initiateVendorCall':
        if (output?.session?.purchase_number) {
          return `Started a vendor call for purchase order ${output.session.purchase_number}.`;
        }
        return 'Started a vendor call.';
      case 'pollVendorCall':
        if (output?.session?.status) {
          return `Vendor call status: ${output.session.status}.`;
        }
        return 'Checked vendor call status.';
      case 'sendVendorCallEmail':
        return output?.emailed_to ? `Email sent to ${output.emailed_to}.` : 'Sent the vendor call follow-up email.';
      default:
        return `Completed ${this.describeTool(tool)} successfully.`;
    }
  }

  private describeTool(tool: string): string {
    switch (tool) {
      case 'createPurchaseOrder':
        return 'create a purchase order';
      case 'updatePurchaseOrder':
        return 'update the purchase order';
      case 'closePurchaseOrder':
        return 'close the purchase order';
      case 'emailPurchaseOrder':
        return 'email the purchase order';
      case 'createSalesOrder':
        return 'create a sales order';
      case 'updateSalesOrder':
        return 'update the sales order';
      case 'createQuote':
        return 'create a quote';
      case 'updateQuote':
        return 'update the quote';
      case 'emailQuote':
        return 'email the quote';
      case 'convertQuoteToSO':
        return 'convert the quote into a sales order';
      case 'updatePickupDetails':
        return 'update pickup details';
      case 'getPickupDetails':
        return 'retrieve pickup details';
      case 'initiateVendorCall':
        return 'start a vendor call';
      case 'pollVendorCall':
        return 'check the vendor call status';
      case 'sendVendorCallEmail':
        return 'send the vendor call email';
      case 'createTask':
        return 'create a task';
      case 'updateTask':
        return 'update the task';
      case 'postTaskMessage':
        return 'post a task update';
      case 'retrieveDocs':
        return 'search the documentation';
      default:
        return tool;
    }
  }
}
