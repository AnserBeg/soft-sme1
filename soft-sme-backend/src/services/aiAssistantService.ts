import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

interface AIResponse {
  response: string;
  sources: string[];
  confidence: number;
  tool_used: string;
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  sources?: string[];
  confidence?: number;
  toolUsed?: string;
}

class AIAssistantService {
  private aiProcess: ChildProcess | null = null;
  private aiEndpoint: string;
  private isLocalMode: boolean;

  constructor() {
    this.isLocalMode = process.env.AI_AGENT_MODE === 'local';
    this.aiEndpoint = process.env.AI_AGENT_ENDPOINT || 'http://localhost:15000';
  }

  /**
   * Start the Python AI agent process
   */
  async startAIAgent(): Promise<void> {
    if (this.isLocalMode) {
      await this.startLocalAIAgent();
      
                              // Wait for the agent to be ready
      let retries = 0;
      const maxRetries = 60; // Increased to 60 (120 seconds total)
      
      while (retries < maxRetries) {
        try {
          const health = await this.getHealthStatus();
          console.log(`Health check attempt ${retries + 1}:`, health);
          
          // Check if the agent is healthy or still starting
          if (health.status === 'healthy' || health.status === 'starting') {
            if (health.status === 'healthy') {
              console.log('AI Agent is ready');
              return;
            } else {
              console.log('AI Agent is starting, continuing to wait...');
            }
          }
        } catch (error) {
          console.log(`Waiting for AI Agent to be ready... (attempt ${retries + 1}/${maxRetries})`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries++;
      }
      
      throw new Error('AI Agent failed to start within expected time');
    }
  }

  /**
   * Start local Python AI agent as child process
   */
  private async startLocalAIAgent(): Promise<void> {
    try {
      const aiAgentPath = path.join(__dirname, '..', '..', 'ai_agent');
      const pythonPath = process.env.PYTHON_PATH || 'python';
      
      // Check if AI agent directory exists
      if (!fs.existsSync(aiAgentPath)) {
        console.error('AI agent directory not found:', aiAgentPath);
        throw new Error('AI agent not properly configured');
      }

      // Start Python AI agent
      this.aiProcess = spawn(pythonPath, ['main.py'], {
        cwd: aiAgentPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: aiAgentPath,
          AI_AGENT_PORT: process.env.AI_AGENT_PORT || '15000'
        }
      });

      // Handle process events
      this.aiProcess.stdout?.on('data', (data) => {
        console.log('AI Agent:', data.toString());
      });

      this.aiProcess.stderr?.on('data', (data) => {
        console.error('AI Agent Error:', data.toString());
      });

      this.aiProcess.on('close', (code) => {
        console.log('AI Agent process closed with code:', code);
        this.aiProcess = null;
      });

      this.aiProcess.on('error', (error) => {
        console.error('AI Agent process error:', error);
        this.aiProcess = null;
      });

      console.log('AI Agent process started');

    } catch (error) {
      console.error('Failed to start AI agent:', error);
      throw error;
    }
  }

  /**
   * Stop the AI agent process
   */
  async stopAIAgent(): Promise<void> {
    if (this.aiProcess) {
      this.aiProcess.kill();
      this.aiProcess = null;
      console.log('AI Agent stopped');
    }
  }

  /**
   * Send message to AI agent and get response
   */
  async sendMessage(message: string, userId?: number, conversationId?: string): Promise<AIResponse> {
    try {
      if (this.isLocalMode) {
        return await this.sendToLocalAgent(message, userId, conversationId);
      } else {
        return await this.sendToRemoteAgent(message, userId, conversationId);
      }
    } catch (error) {
      console.error('Error sending message to AI agent:', error);
      throw new Error('Failed to get response from AI assistant');
    }
  }

  /**
   * Send message to local AI agent via HTTP
   */
  private async sendToLocalAgent(message: string, userId?: number, conversationId?: string): Promise<AIResponse> {
    try {
      const response = await axios.post(`${this.aiEndpoint}/chat`, {
        message,
        user_id: userId,
        conversation_id: conversationId
      }, {
        timeout: 60000 // 60 second timeout
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('AI Agent HTTP error:', error.response?.data || error.message);
      }
      throw error;
    }
  }

  /**
   * Send message to remote AI agent
   */
  private async sendToRemoteAgent(message: string, userId?: number, conversationId?: string): Promise<AIResponse> {
    try {
      const response = await axios.post(`${this.aiEndpoint}/chat`, {
        message,
        user_id: userId,
        conversation_id: conversationId
      }, {
        timeout: 60000
      });

      return response.data;
    } catch (error) {
      console.error('Remote AI Agent error:', error);
      throw error;
    }
  }

  /**
   * Get AI agent health status
   */
  async getHealthStatus(): Promise<{ status: string; details?: any }> {
    try {
      const healthUrl = `${this.aiEndpoint}/health`;
      console.log(`🔍 Health check: Attempting to access ${healthUrl}`);
      
      const response = await axios.get(healthUrl, {
        timeout: 5000
      });
      
      console.log(`✅ Health check successful: ${response.status} - ${JSON.stringify(response.data)}`);
      
      // The Python endpoint returns a HealthResponse object
      const healthData = response.data;
      
      // Return a simplified status for the Node.js logic
      return {
        status: healthData.status,
        details: healthData.details || healthData
      };
    } catch (error) {
      console.log(`❌ Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (axios.isAxiosError(error)) {
        console.log(`   Status: ${error.response?.status}`);
        console.log(`   URL: ${error.config?.url}`);
        console.log(`   Method: ${error.config?.method}`);
      }
      
      return {
        status: 'unhealthy',
        details: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Initialize AI agent (setup vector database, etc.)
   */
  async initializeAI(): Promise<void> {
    try {
      const response = await axios.post(`${this.aiEndpoint}/initialize`, {}, {
        timeout: 60000 // 60 second timeout for initialization
      });
      console.log('AI Agent initialized:', response.data);
    } catch (error) {
      console.error('Failed to initialize AI agent:', error);
      throw error;
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const response = await axios.get(`${this.aiEndpoint}/conversation/${conversationId}`);
      return response.data.messages || [];
    } catch (error) {
      console.error('Failed to get conversation history:', error);
      return [];
    }
  }

  /**
   * Clear conversation history
   */
  async clearConversationHistory(conversationId: string): Promise<void> {
    try {
      await axios.delete(`${this.aiEndpoint}/conversation/${conversationId}`);
    } catch (error) {
      console.error('Failed to clear conversation history:', error);
      throw error;
    }
  }

  /**
   * Get AI agent statistics
   */
  async getStatistics(): Promise<any> {
    try {
      const response = await axios.get(`${this.aiEndpoint}/stats`);
      return response.data;
    } catch (error) {
      console.error('Failed to get AI agent statistics:', error);
      return {};
    }
  }
}

// Export singleton instance
export const aiAssistantService = new AIAssistantService();
export default aiAssistantService; 