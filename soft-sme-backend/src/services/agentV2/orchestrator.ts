import { Pool } from 'pg';

export interface AgentToolRegistry {
  [name: string]: (args: any) => Promise<any>;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  example?: string;
}

export interface ToolInvocationTrace {
  tool: string;
  success: boolean;
  input?: any;
  output?: any;
  error?: string;
  message: string;
  link?: string;
  linkLabel?: string;
}

export interface AgentOrchestratorReply {
  type: 'action' | 'documentation' | 'message';
  message: string;
  traces?: ToolInvocationTrace[];
  docs?: Array<{ path: string; section?: string; chunk: string }>;
  catalog: ToolCatalogEntry[];
}

export class AgentOrchestratorV2 {
  private readonly toolCatalog: ToolCatalogEntry[];

  constructor(private pool: Pool, private tools: AgentToolRegistry) {
    this.toolCatalog = this.buildToolCatalog();
  }

  getToolCatalog(): ToolCatalogEntry[] {
    return this.toolCatalog;
  }

  async handleMessage(sessionId: number, message: string): Promise<AgentOrchestratorReply> {
    const base: Pick<AgentOrchestratorReply, 'catalog'> = {
      catalog: this.toolCatalog,
    };

    const intent = this.classifyIntent(message);

    if (intent && this.tools[intent.tool]) {
      try {
        const result = await this.tools[intent.tool](intent.args);
        const trace = this.buildTrace(intent.tool, true, intent.args, result);
        return {
          ...base,
          type: 'action',
          message: trace.message,
          traces: [trace],
        };
      } catch (error: any) {
        const trace = this.buildTrace(intent.tool, false, intent.args, undefined, error);
        return {
          ...base,
          type: 'action',
          message: trace.message,
          traces: [trace],
        };
      }
    }

    if (this.tools['retrieveDocs']) {
      const result = await this.tools['retrieveDocs']({ query: message });
      return {
        ...base,
        type: 'documentation',
        message: 'Here are some documentation matches that might help:',
        docs: Array.isArray(result) ? result : [],
      };
    }

    return {
      ...base,
      type: 'message',
      message: 'I can help with sales orders, purchase orders, quotes, and emails. What would you like to do?',
    };
  }

  private classifyIntent(message: string): { tool: string; args: any } | null {
    const m = message.toLowerCase();
    if (m.includes('create') && m.includes('sales order')) return { tool: 'createSalesOrder', args: {} };
    if (m.includes('update') && m.includes('sales order')) return { tool: 'updateSalesOrder', args: {} };
    if (m.includes('create') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'createPurchaseOrder', args: {} };
    if (m.includes('update') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'updatePurchaseOrder', args: {} };
    if ((m.includes('close') || m.includes('complete')) && (m.includes('purchase order') || m.includes('po'))) return { tool: 'closePurchaseOrder', args: {} };
    if (m.includes('email') && (m.includes('purchase order') || m.includes('po'))) return { tool: 'emailPurchaseOrder', args: {} };
    if (m.includes('call') && m.includes('vendor')) return { tool: 'initiateVendorCall', args: {} };
    if ((m.includes('call') && m.includes('status')) || m.includes('call update')) return { tool: 'pollVendorCall', args: {} };
    if (m.includes('send') && m.includes('po') && m.includes('email') && m.includes('call')) return { tool: 'sendVendorCallEmail', args: {} };
    if (m.includes('create') && m.includes('quote')) return { tool: 'createQuote', args: {} };
    if (m.includes('update') && m.includes('quote')) return { tool: 'updateQuote', args: {} };
    if (m.includes('email') && m.includes('quote')) return { tool: 'emailQuote', args: {} };
    if (m.includes('convert') && m.includes('quote') && (m.includes('sales order') || m.includes('so'))) return { tool: 'convertQuoteToSO', args: {} };
    
    // Pickup-related intents
    if (m.includes('pickup') && m.includes('time')) return { tool: 'updatePickupDetails', args: { pickup_time: message } };
    if (m.includes('pickup') && m.includes('location')) return { tool: 'updatePickupDetails', args: { pickup_location: message } };
    if (m.includes('pickup') && m.includes('contact')) return { tool: 'updatePickupDetails', args: { pickup_contact_person: message } };
    if (m.includes('pickup') && m.includes('phone')) return { tool: 'updatePickupDetails', args: { pickup_phone: message } };
    if (m.includes('pickup') && m.includes('instructions')) return { tool: 'updatePickupDetails', args: { pickup_instructions: message } };
    if (m.includes('pickup') && m.includes('notes')) return { tool: 'updatePickupDetails', args: { pickup_notes: message } };
    if (m.includes('get') && m.includes('pickup')) return { tool: 'getPickupDetails', args: {} };
    
    if (m.includes('doc') || m.includes('how do i')) return { tool: 'retrieveDocs', args: { query: message } };
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
      { name: 'retrieveDocs', description: 'Search internal documentation for workflows and UI guidance.' },
    ];
  }

  private buildTrace(tool: string, success: boolean, input?: any, output?: any, error?: any): ToolInvocationTrace {
    const message = this.describeActionOutcome(tool, success, output, error);
    const trace: ToolInvocationTrace = {
      tool,
      success,
      input,
      output,
      message,
    };

    if (!success && error) {
      trace.error = error instanceof Error ? error.message : String(error);
    }

    const linkInfo = this.buildLink(tool, success, output);
    if (linkInfo) {
      trace.link = linkInfo.href;
      if (linkInfo.label) {
        trace.linkLabel = linkInfo.label;
      }
    }

    return trace;
  }

  private describeActionOutcome(tool: string, success: boolean, output?: any, error?: any): string {
    if (!success) {
      const errorMsg = error instanceof Error ? error.message : String(error || 'Unknown error');
      return `Failed to ${this.describeTool(tool)}: ${errorMsg}`;
    }

    switch (tool) {
      case 'createPurchaseOrder':
        if (output?.purchase_number) {
          return `Created purchase order ${output.purchase_number}.`;
        }
        return 'Purchase order created successfully.';
      case 'updatePurchaseOrder':
        return 'Updated the purchase order successfully.';
      case 'closePurchaseOrder':
        return 'Closed the purchase order successfully.';
      case 'emailPurchaseOrder':
        return 'Sent the purchase order email successfully.';
      case 'createSalesOrder':
        if (output?.sales_order_number) {
          return `Created sales order ${output.sales_order_number}.`;
        }
        return 'Sales order created successfully.';
      case 'updateSalesOrder':
        return 'Updated the sales order successfully.';
      case 'createQuote':
        if (output?.quote_number) {
          return `Created quote ${output.quote_number}.`;
        }
        return 'Quote created successfully.';
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
      default:
        return `Completed ${this.describeTool(tool)} successfully.`;
    }
  }

  private buildLink(tool: string, success: boolean, output?: any): { href: string; label?: string } | null {
    if (!success || !output) {
      return null;
    }

    switch (tool) {
      case 'createPurchaseOrder':
      case 'updatePurchaseOrder':
      case 'closePurchaseOrder':
      case 'getPickupDetails':
      case 'updatePickupDetails':
      case 'emailPurchaseOrder':
        if (output?.purchase_id) {
          return {
            href: `/open-purchase-orders/${output.purchase_id}`,
            label: 'View purchase order',
          };
        }
        break;
      case 'createSalesOrder':
      case 'updateSalesOrder':
        if (output?.sales_order_id) {
          return {
            href: `/sales-orders/${output.sales_order_id}`,
            label: 'View sales order',
          };
        }
        break;
      case 'createQuote':
      case 'updateQuote':
      case 'emailQuote':
      case 'convertQuoteToSO':
        if (output?.quote_id) {
          return {
            href: `/quotes/${output.quote_id}`,
            label: 'View quote',
          };
        }
        break;
      default:
        break;
    }

    return null;
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
      case 'retrieveDocs':
        return 'search the documentation';
      default:
        return tool;
    }
  }
}


