import { Pool } from 'pg';
import { AgentToolsV2 } from './tools';

export interface AgentToolRegistry {
  [name: string]: (args: any) => Promise<any>;
}

export class AgentOrchestratorV2 {
  constructor(private pool: Pool, private tools: AgentToolRegistry) {}

  async handleMessage(sessionId: number, message: string): Promise<string> {
    const intent = this.classifyIntent(message);
    if (intent && this.tools[intent.tool]) {
      const result = await this.tools[intent.tool](intent.args);
      return JSON.stringify(result);
    }
    if (this.tools['retrieveDocs']) {
      const result = await this.tools['retrieveDocs']({ query: message });
      return JSON.stringify({ info: 'Relevant docs', chunks: result });
    }
    return `I can help with sales orders, purchase orders, quotes, and emails. What would you like to do?`;
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
}


