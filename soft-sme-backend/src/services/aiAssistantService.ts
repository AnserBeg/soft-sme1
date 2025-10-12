import axios, { AxiosRequestConfig } from 'axios';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AIService } from './aiService';

const sanitizeEnvValue = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const withoutQuotes = trimmed.replace(/^['"](.+)['"]$/s, '$1').trim();

  return withoutQuotes.length > 0 ? withoutQuotes : undefined;
};

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
  private missingAuthWarningLogged = false;

  constructor() {
    const configuredMode = process.env.AI_AGENT_MODE?.trim().toLowerCase();
    const desiredMode: 'local' | 'remote' = configuredMode === 'local' ? 'local' : 'remote';

    const resolvedEndpoint = this.resolveAgentEndpoint(desiredMode);
    const endpointIsLocal = this.isLocalEndpoint(resolvedEndpoint);

    if (desiredMode === 'remote' && endpointIsLocal) {
      console.warn(
        `[AI Assistant] Remote mode requested but the endpoint resolves to a local address (${resolvedEndpoint}). ` +
          'Automatically starting the embedded AI agent instead of falling back to Gemini.'
      );
    }

    this.isLocalMode = desiredMode === 'local' || endpointIsLocal;
    this.aiEndpoint = resolvedEndpoint;

    const modeNote = desiredMode === 'remote' && this.isLocalMode ? ' (auto-local mode)' : '';

    console.log(
      `[AI Assistant] Running in ${this.isLocalMode ? 'local' : 'remote'} mode${modeNote}. ` +
      `Using AI agent endpoint: ${this.aiEndpoint}`
    );
  }

  private resolveAgentEndpoint(desiredMode: 'local' | 'remote'): string {
    const remoteUrlOverride = process.env.AI_AGENT_REMOTE_URL?.trim();
    if (remoteUrlOverride) {
      const normalizedRemote = this.normalizeEndpoint(remoteUrlOverride);
      const withoutChatSuffix = normalizedRemote.replace(/\/chat$/i, '');
      return withoutChatSuffix.length > 0 ? withoutChatSuffix : '/';
    }

    const urlOverride = process.env.AI_AGENT_URL?.trim();
    if (urlOverride) {
      return this.normalizeEndpoint(urlOverride);
    }

    const configuredEndpoint = process.env.AI_AGENT_ENDPOINT?.trim();
    if (configuredEndpoint) {
      return this.normalizeEndpoint(configuredEndpoint);
    }

    const host = process.env.AI_AGENT_HOST?.trim();
    const port = process.env.AI_AGENT_PORT?.trim();
    const protocolEnv = process.env.AI_AGENT_PROTOCOL?.trim();

    if (host) {
      const hasProtocol = host.startsWith('http://') || host.startsWith('https://');
      const protocol = protocolEnv || (hasProtocol ? undefined : port === '443' ? 'https' : 'http');

      if (hasProtocol) {
        return this.normalizeEndpoint(host);
      }

      const portSegment = port && port.length > 0 ? `:${port}` : '';
      const base = `${protocol || 'http'}://${host}${portSegment}`;
      return this.normalizeEndpoint(base);
    }

    if (desiredMode === 'local') {
      return this.normalizeEndpoint('http://127.0.0.1:15000');
    }

    const proxyPath = process.env.AI_AGENT_PROXY_PATH?.trim();
    if (proxyPath) {
      return this.normalizeEndpoint(proxyPath);
    }

    return this.normalizeEndpoint('/api/ai-assistant');
  }

  private normalizeEndpoint(endpoint: string): string {
    if (!endpoint) {
      return '/api/ai-assistant';
    }

    const trimmed = endpoint.trim();

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed.replace(/\/+$/, '');
    }

    if (trimmed.startsWith('/')) {
      const normalized = trimmed.replace(/\/+$/, '');
      return normalized.length > 0 ? normalized : '/';
    }

    const withoutSlashes = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    return withoutSlashes.length > 0 ? `/${withoutSlashes}` : '/';
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
      const pythonPath = process.env.PYTHON_PATH || 'python3';
      const pythonExecutable = this.preparePythonEnvironment(pythonPath, aiAgentPath);

      const defaultHost = process.env.AI_AGENT_HOST?.trim() || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
      
      // Check if AI agent directory exists
      if (!fs.existsSync(aiAgentPath)) {
        console.error('AI agent directory not found:', aiAgentPath);
        throw new Error('AI agent not properly configured');
      }

      // Start Python AI agent
      this.aiProcess = spawn(pythonExecutable, ['main.py'], {
        cwd: aiAgentPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: aiAgentPath,
          AI_AGENT_PORT: process.env.AI_AGENT_PORT || '15000',
          AI_AGENT_HOST: defaultHost
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

  private preparePythonEnvironment(pythonPath: string, aiAgentPath: string): string {
    const venvPath = path.join(aiAgentPath, '.venv');
    const requirementsPath = path.join(aiAgentPath, 'requirements.txt');
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const pythonExecutable = path.join(
      venvPath,
      binDir,
      process.platform === 'win32' ? 'python.exe' : 'python'
    );
    const pipExecutable = path.join(
      venvPath,
      binDir,
      process.platform === 'win32' ? 'pip.exe' : 'pip'
    );
    const requirementsHash = this.hashFile(requirementsPath);
    const hashFilePath = path.join(venvPath, '.requirements-hash');

    const needsSetup =
      !fs.existsSync(pythonExecutable) ||
      !fs.existsSync(hashFilePath) ||
      fs.readFileSync(hashFilePath, 'utf8').trim() !== requirementsHash;

    if (needsSetup) {
      console.log('[AI Assistant] Preparing Python environment for embedded AI agent');

      this.runCommand(pythonPath, ['-m', 'venv', venvPath], aiAgentPath);

      if (!fs.existsSync(pipExecutable)) {
        throw new Error('Failed to initialize Python virtual environment for AI agent');
      }

      this.runCommand(pipExecutable, ['install', '--upgrade', 'pip', 'setuptools', 'wheel'], aiAgentPath);

      if (fs.existsSync(requirementsPath)) {
        this.runCommand(pipExecutable, ['install', '-r', requirementsPath], aiAgentPath);
      }

      fs.writeFileSync(hashFilePath, requirementsHash, 'utf8');
    }

    return pythonExecutable;
  }

  private hashFile(filePath: string): string {
    if (!filePath || !fs.existsSync(filePath)) {
      return '';
    }

    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  private runCommand(command: string, args: string[], cwd: string): void {
    console.log(`[AI Assistant] Running command: ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd, stdio: 'inherit' });

    if (result.error) {
      throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}`);
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
      if (this.shouldFallbackToGemini(error)) {
        console.warn('[AI Assistant] Primary AI agent unavailable. Falling back to direct Gemini service.');

        try {
          return await this.createGeminiFallbackResponse(message, userId);
        } catch (fallbackError) {
          console.error('[AI Assistant] Gemini fallback failed:', fallbackError);
          throw new Error('AI assistant is currently unavailable. Please try again later.');
        }
      }

      console.error('Error sending message to AI agent:', error);
      throw new Error('Failed to get response from AI assistant');
    }
  }

  /**
   * Send message to local AI agent via HTTP
   */
  private async sendToLocalAgent(message: string, userId?: number, conversationId?: string): Promise<AIResponse> {
    try {
      const response = await axios.post(
        `${this.aiEndpoint}/chat`,
        {
          message,
          user_id: userId,
          conversation_id: conversationId
        },
        this.createRequestConfig({
          timeout: 60000 // 60 second timeout
        })
      );

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
    const payload = {
      message,
      user_id: userId,
      conversation_id: conversationId
    };

    const attemptedEndpoints: string[] = [];
    let lastError: unknown = null;

    for (const endpoint of this.getRemoteEndpointCandidates()) {
      const chatUrl = `${endpoint}/chat`;
      attemptedEndpoints.push(chatUrl);

      try {
        const response = await axios.post(
          chatUrl,
          payload,
          this.createRequestConfig({
            timeout: 60000
          })
        );

        if (endpoint !== this.aiEndpoint) {
          console.warn(
            `[AI Assistant] Remote endpoint ${this.aiEndpoint} returned 404. Switching to fallback endpoint ${endpoint}.`
          );
          this.aiEndpoint = endpoint;
        }

        return response.data;
      } catch (error) {
        lastError = error;

        if (axios.isAxiosError(error) && error.response?.status === 404) {
          console.warn(`[AI Assistant] Remote endpoint ${chatUrl} returned 404. Trying next fallback endpoint if available.`);
          continue;
        }

        console.error('Remote AI Agent error:', error);
        throw error;
      }
    }

    console.error('[AI Assistant] All remote AI agent endpoints failed:', attemptedEndpoints.join(', '));
    if (lastError) {
      throw lastError;
    }

    throw new Error('Remote AI agent is unavailable');
  }

  private getRemoteEndpointCandidates(): string[] {
    const normalized = this.aiEndpoint.replace(/\/+$/, '') || '/';
    const candidates = new Set<string>();
    const currentPath = this.extractPathFromEndpoint(normalized);

    const addCandidate = (endpoint: string | null) => {
      if (!endpoint) {
        return;
      }
      const sanitized = endpoint.replace(/\/+$/, '') || '/';
      candidates.add(sanitized);
    };

    addCandidate(normalized);

    const fallbackPaths = ['/api/ai-assistant', '/api/ai', '/ai-assistant'];

    for (const path of fallbackPaths) {
      if (currentPath === path) {
        continue;
      }

      const fallback = this.replaceEndpointPath(normalized, path);
      if (fallback) {
        addCandidate(fallback);
      }
    }

    return Array.from(candidates);
  }

  private extractPathFromEndpoint(endpoint: string): string | null {
    if (!endpoint) {
      return null;
    }

    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      try {
        const url = new URL(endpoint);
        return url.pathname.replace(/\/+$/, '') || '/';
      } catch (error) {
        console.warn('[AI Assistant] Unable to parse endpoint URL for path extraction:', error);
        return null;
      }
    }

    if (endpoint.startsWith('/')) {
      return endpoint.replace(/\/+$/, '') || '/';
    }

    return null;
  }

  private replaceEndpointPath(endpoint: string, newPath: string): string | null {
    const normalizedPath = newPath.startsWith('/') ? newPath : `/${newPath}`;

    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      try {
        const url = new URL(endpoint);
        url.pathname = normalizedPath;
        return url.toString().replace(/\/+$/, '');
      } catch (error) {
        console.warn('[AI Assistant] Unable to build fallback endpoint URL:', error);
        return null;
      }
    }

    if (endpoint.startsWith('/')) {
      return normalizedPath.replace(/\/+$/, '') || '/';
    }

    return null;
  }

  /**
   * Get AI agent health status
   */
  async getHealthStatus(): Promise<{ status: string; details?: any }> {
    try {
      const healthUrl = `${this.aiEndpoint}/health`;
      console.log(`🔍 Health check: Attempting to access ${healthUrl}`);
      
      const response = await axios.get(
        healthUrl,
        this.createRequestConfig({
          timeout: 5000
        })
      );
      
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
      const response = await axios.post(
        `${this.aiEndpoint}/initialize`,
        {},
        this.createRequestConfig({
          timeout: 60000 // 60 second timeout for initialization
        })
      );
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
      const response = await axios.get(
        `${this.aiEndpoint}/conversation/${conversationId}`,
        this.createRequestConfig()
      );
      const rawMessages = Array.isArray(response.data?.messages) ? response.data.messages : [];

      return rawMessages.map((message: any) => {
        const normalizedIsUser =
          typeof message?.isUser === 'boolean'
            ? message.isUser
            : Boolean(message?.is_user);

        const timestamp = message?.timestamp ? new Date(message.timestamp) : new Date();

        return {
          id: typeof message?.id === 'string' ? message.id : String(message?.id ?? crypto.randomUUID()),
          text: typeof message?.text === 'string' ? message.text : '',
          isUser: normalizedIsUser,
          timestamp,
          sources: Array.isArray(message?.sources) ? message.sources : undefined,
          confidence:
            typeof message?.confidence === 'number'
              ? message.confidence
              : undefined,
          toolUsed:
            typeof message?.toolUsed === 'string'
              ? message.toolUsed
              : typeof message?.tool_used === 'string'
              ? message.tool_used
              : undefined
        };
      });
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
      await axios.delete(
        `${this.aiEndpoint}/conversation/${conversationId}`,
        this.createRequestConfig()
      );
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
      const response = await axios.get(
        `${this.aiEndpoint}/stats`,
        this.createRequestConfig()
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get AI agent statistics:', error);
      return {};
    }
  }

  private isLocalEndpoint(endpoint: string): boolean {
    try {
      const url = new URL(endpoint);
      const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
      return localHosts.has(url.hostname);
    } catch (error) {
      console.warn('[AI Assistant] Unable to parse AI endpoint URL:', error);
      return false;
    }
  }

  private shouldFallbackToGemini(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const code = (error.code || '').toUpperCase();
      const transientNetworkCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH']);

      if (transientNetworkCodes.has(code)) {
        return true;
      }

      // Axios sets `response` for HTTP errors. If it's undefined the request
      // never reached the server which usually indicates a connectivity issue.
      return !error.response;
    }

    if (error instanceof Error) {
      return error.message.toLowerCase().includes('econnrefused') ||
        error.message.toLowerCase().includes('ai agent not properly configured');
    }

    return false;
  }

  private createRequestConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
    const headers = this.getServiceAuthHeaders();

    if (!headers) {
      return config ?? {};
    }

    return {
      ...(config ?? {}),
      headers: {
        ...(config?.headers ?? {}),
        ...headers
      }
    };
  }

  private getServiceAuthHeaders(): Record<string, string> | undefined {
    if (this.isLocalMode) {
      return undefined;
    }

    const headers: Record<string, string> = {};
    const bearerToken = sanitizeEnvValue(process.env.AI_AGENT_SERVICE_TOKEN);
    const apiKey = sanitizeEnvValue(process.env.AI_AGENT_SERVICE_API_KEY);

    if (bearerToken) {
      headers['Authorization'] = bearerToken.startsWith('Bearer ')
        ? bearerToken
        : `Bearer ${bearerToken}`;
    }

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    if (Object.keys(headers).length === 0) {
      if (!this.missingAuthWarningLogged) {
        console.warn(
          '[AI Assistant] Remote mode enabled but no AI_AGENT_SERVICE_TOKEN or AI_AGENT_SERVICE_API_KEY set. ' +
            'Remote requests may fail with 401 Unauthorized.'
        );
        this.missingAuthWarningLogged = true;
      }
      return undefined;
    }

    return headers;
  }

  private async createGeminiFallbackResponse(message: string, userId?: number): Promise<AIResponse> {
    const fallbackResponse = await AIService.sendMessage(message, userId);

    return {
      response: fallbackResponse,
      sources: ['gemini'],
      confidence: 0.6,
      tool_used: 'gemini_direct'
    };
  }
}

// Export singleton instance
export const aiAssistantService = new AIAssistantService();
export default aiAssistantService; 