// Chat service that calls the backend API
// All AI configuration is now managed securely on the backend
import api from '../api/axios';

export interface ChatResponse {
  response: string;
  sources: string[];
  confidence: number;
  toolUsed: string;
  timestamp: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export const chatService = {
  // Test function to verify backend connection
  async testConnection(): Promise<boolean> {
    try {
      const response = await api.get('/api/ai-assistant/health');
      console.log('AI Assistant Health Check:', response.data);
      return response.data.success && response.data.data.status === 'healthy';
    } catch (error) {
      console.error('AI Assistant Health Check Error:', error);
      return false;
    }
  },

  async sendMessage(message: string, conversationId?: string): Promise<ChatResponse> {
    try {
      console.log('Sending message to AI assistant:', message);
      
      const request: ChatRequest = { message };
      if (conversationId) {
        request.conversationId = conversationId;
      }
      
      const response = await api.post('/api/ai-assistant/chat', request);
      
      console.log('AI Assistant Response:', response.data);
      
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get response from AI assistant');
      }
    } catch (error) {
      console.error('Error calling AI assistant API:', error);
      
      // Fallback to contextual responses if API fails
      return {
        response: this.getFallbackResponse(message),
        sources: ['fallback'],
        confidence: 0.5,
        toolUsed: 'fallback',
        timestamp: new Date().toISOString()
      };
    }
  },

  async getConversationHistory(conversationId: string): Promise<any[]> {
    try {
      const response = await api.get(`/api/ai-assistant/conversation/${conversationId}`);
      return response.data.success ? response.data.data.messages : [];
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return [];
    }
  },

  async clearConversation(conversationId: string): Promise<boolean> {
    try {
      const response = await api.delete(`/api/ai-assistant/conversation/${conversationId}`);
      return response.data.success;
    } catch (error) {
      console.error('Error clearing conversation:', error);
      return false;
    }
  },

  async getStatistics(): Promise<any> {
    try {
      const response = await api.get('/api/ai-assistant/stats');
      return response.data.success ? response.data.data : {};
    } catch (error) {
      console.error('Error getting AI assistant statistics:', error);
      return {};
    }
  },

  // Fallback responses in case API is unavailable
  getFallbackResponse(message: string): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      return "Hello! I'm your AI assistant for the NeuraTask business management system. How can I help you today?";
    }
    
    if (lowerMessage.includes('inventory') || lowerMessage.includes('stock')) {
      return "I can help you with inventory management. You can check your current stock levels, add new items, or track inventory movements in the Inventory section. Navigate to 'Stock' in the sidebar to manage your inventory.";
    }
    
    if (lowerMessage.includes('customer') || lowerMessage.includes('client')) {
      return "For customer management, you can view and manage your customer database in the Customers section. You can add new customers, view their details, and track their orders. Find this in the 'Customers' section of the sidebar.";
    }
    
    if (lowerMessage.includes('purchase') || lowerMessage.includes('order')) {
      return "Purchase orders can be managed in the Purchase Orders section. You can create new orders, track existing ones, and manage vendor relationships. Look for 'Purchase Orders' in the sidebar under the Purchasing section.";
    }
    
    if (lowerMessage.includes('sales') || lowerMessage.includes('quote')) {
      return "Sales and quotes are handled in the Sales Orders and Quotes sections. You can create quotes, convert them to orders, and track your sales pipeline. These are available in the 'Sales' section of the sidebar.";
    }
    
    if (lowerMessage.includes('time') || lowerMessage.includes('tracking')) {
      return "Time tracking features are available in the Time Tracking section. You can log hours, view reports, and manage employee attendance. Find this under 'Employees & Time Tracking' in the sidebar.";
    }
    
    if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
      return "I'm here to help! You can ask me about any aspect of the NeuraTask system - inventory, customers, orders, time tracking, or general navigation. What would you like to know?";
    }
    
    return "I'm here to help you with the NeuraTask business management system. You can ask me about inventory, customers, purchase orders, sales, time tracking, or any other features. How can I assist you?";
  }
}; 