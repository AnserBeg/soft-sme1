import axios, { AxiosRequestConfig } from 'axios';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../db';
import { AIService } from './aiService';
import { ConversationManager, ConversationMessage } from './aiConversationManager';
import { AITaskQueueService } from './aiTaskQueueService';

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

const DEFAULT_HEALTH_URL = 'http://127.0.0.1:15000/healthz';
const PROD_AGENT_BASE_URL = sanitizeEnvValue(process.env.PROD_AGENT_BASE_URL);
const parseEnvInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const HEALTH_URL_OVERRIDE = sanitizeEnvValue(process.env.AI_AGENT_HEALTH_URL);
const HEALTH_URL = HEALTH_URL_OVERRIDE ?? DEFAULT_HEALTH_URL;
const MAX_ATTEMPTS = parseEnvInt(
  sanitizeEnvValue(process.env.AI_AGENT_HEALTH_RETRIES)
    ?? sanitizeEnvValue(process.env.AI_HEALTH_RETRIES),
  60
);
const DELAY_MS = parseEnvInt(
  sanitizeEnvValue(process.env.AI_AGENT_HEALTH_DELAY_MS)
    ?? sanitizeEnvValue(process.env.AI_HEALTH_INTERVAL_MS),
  1000
);
const INITIAL_DELAY_MS = parseEnvInt(sanitizeEnvValue(process.env.AI_AGENT_HEALTH_INITIAL_DELAY_MS), 0);

interface AIResponse {
  response: string;
  sources: string[];
  confidence: number;
  tool_used: string;
  conversation_id?: string;
  actions?: any[];
  action_message?: string | null;
  action_catalog?: any[];
  planner_plan?: any;
  documentation_subagent?: any;
  documentation_results?: any[];
  processing_time?: number;
  critic_feedback?: Record<string, any> | null;
  row_selection_candidates?: any[];
  safety_results?: any[];
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  sources?: string[];
  confidence?: number;
  toolUsed?: string;
  metadata?: Record<string, unknown>;
}

class AIAssistantService {
  private aiProcess: ChildProcess | null = null;
  private aiEndpoint: string;
  private isLocalMode: boolean;
  private missingAuthWarningLogged = false;
  private conversationManager: ConversationManager;
  private taskQueue: AITaskQueueService;
  private aiHealthUrl: string | null = null;

  constructor() {
    const configuredMode = process.env.AI_AGENT_MODE?.trim().toLowerCase();
    const desiredMode: 'local' | 'remote' = configuredMode === 'local' ? 'local' : 'remote';

    const resolvedEndpoint = this.resolveAgentEndpoint(desiredMode);
    const endpointIsLocal = this.isLocalEndpoint(resolvedEndpoint);
    const endpointIsRemote = this.isRemoteEndpoint(resolvedEndpoint);

    if (desiredMode === 'remote' && endpointIsLocal) {
      console.warn(
        `[AI Assistant] Remote mode requested but the endpoint resolves to a local address (${resolvedEndpoint}). ` +
          'Automatically starting the embedded AI agent instead of falling back to Gemini.'
      );
    }

    this.isLocalMode = !endpointIsRemote && (desiredMode === 'local' || endpointIsLocal);
    this.aiEndpoint = resolvedEndpoint;
    this.aiHealthUrl = this.resolveHealthCheckUrl(this.aiEndpoint);
    this.conversationManager = new ConversationManager(pool);
    this.taskQueue = new AITaskQueueService(pool);

    const modeNote = desiredMode === 'remote' && this.isLocalMode ? ' (auto-local mode)' : '';

    console.log(
      `[AI Assistant] Running in ${this.isLocalMode ? 'local' : 'remote'} mode${modeNote}. ` +
      `Using AI agent endpoint: ${this.aiEndpoint}`
    );
  }

  private resolveAgentEndpoint(desiredMode: 'local' | 'remote'): string {
    if (PROD_AGENT_BASE_URL) {
      return this.normalizeEndpoint(PROD_AGENT_BASE_URL);
    }

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
    if (!this.isLocalMode) {
      const healthUrl = this.aiHealthUrl ?? this.resolveHealthCheckUrl(this.aiEndpoint);
      const hasAbsoluteUrl = typeof healthUrl === 'string' && /^https?:\/\//i.test(healthUrl);

      if (!hasAbsoluteUrl) {
        console.warn(
          `[AI Assistant] Remote AI agent configured but health URL "${healthUrl}" is not absolute. Skipping startup health check.`
        );
        return;
      }

      console.log(`[AI Assistant] Remote AI agent configured; verifying health at ${healthUrl}`);
      await this.waitForAgentHealthy(healthUrl);
      console.log('[AI Assistant] Remote AI agent health verified');
      return;
    }

    const config = await this.startLocalAIAgent();
    const normalizedEndpoint = this.normalizeEndpoint(config.url);
    this.aiEndpoint = normalizedEndpoint;
    const healthUrl = this.resolveHealthCheckUrl(normalizedEndpoint);
    this.aiHealthUrl = healthUrl;

    try {
      console.log(`[AI Agent] waiting for health check at ${healthUrl}`);
      await this.waitForAgentHealthy(healthUrl);
    } catch (error) {
      console.error('[AI Agent] Failed health checks during startup:', error);

      if (this.aiProcess) {
        this.aiProcess.kill();
        this.aiProcess = null;
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Start local Python AI agent as child process
   */
  private async startLocalAIAgent(): Promise<{ host: string; port: number; url: string }> {
    try {
      const aiAgentPath = path.join(__dirname, '..', '..', 'ai_agent');
      const pythonPath = process.env.PYTHON_PATH || 'python3';
      const pythonExecutable = this.preparePythonEnvironment(pythonPath, aiAgentPath);

      if (!fs.existsSync(aiAgentPath)) {
        console.error('[AI Agent] Directory not found:', aiAgentPath);
        throw new Error('AI agent not properly configured');
      }

      const host = sanitizeEnvValue(process.env.AI_AGENT_HOST) || '127.0.0.1';
      const portRaw = sanitizeEnvValue(process.env.AI_AGENT_PORT);
      const parsedPort = portRaw ? Number(portRaw) : undefined;
      const port = Number.isFinite(parsedPort) && parsedPort ? parsedPort : 15000;
      const portString = port.toString();
      const url = `http://${host}:${portString}`;

      const pythonPathEntries = [aiAgentPath, path.join(aiAgentPath, '..')];
      const pythonPathValue = pythonPathEntries.join(path.delimiter);
      const existingPythonPath = sanitizeEnvValue(process.env.PYTHONPATH);
      const pythonPathEnvValue = existingPythonPath
        ? `${pythonPathValue}${path.delimiter}${existingPythonPath}`
        : pythonPathValue;

      const spawnArgs = [
        '-m',
        'uvicorn',
        'ai_agent.app:app',
        '--host',
        host,
        '--port',
        portString,
        '--workers',
        '1'
      ];

      console.log(`[AI Agent] Spawning local process: ${pythonExecutable} ${spawnArgs.join(' ')}`);

      this.aiProcess = spawn(pythonExecutable, spawnArgs, {
        cwd: aiAgentPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: pythonPathEnvValue,
          AI_AGENT_PORT: portString,
          AI_AGENT_HOST: host
        }
      });

      const logStream = (prefix: string, data: Buffer) => {
        data
          .toString()
          .split(/\r?\n/)
          .map(line => line.trimEnd())
          .filter(line => line.length > 0)
          .forEach(line => console[prefix === 'stderr' ? 'error' : 'log'](`[AI Agent] ${line}`));
      };

      this.aiProcess.stdout?.on('data', data => logStream('stdout', data));
      this.aiProcess.stderr?.on('data', data => logStream('stderr', data));

      this.aiProcess.on('close', code => {
        console.error('[AI Agent] process closed with code:', code);
        this.aiProcess = null;
      });

      this.aiProcess.on('error', error => {
        console.error('[AI Agent] process error:', error);
        this.aiProcess = null;
      });

      console.log(`[AI Agent] process started on ${host}:${portString}`);

      return { host, port, url };
    } catch (error) {
      console.error('Failed to start AI agent:', error);
      throw error;
    }
  }

  private async waitForAgentHealthy(healthUrl: string): Promise<void> {
    const fetchImpl = globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
      throw new Error('Global fetch API is not available in this runtime.');
    }

    const targetUrl = HEALTH_URL_OVERRIDE ?? healthUrl ?? HEALTH_URL;
    const retryLimit = MAX_ATTEMPTS;
    const maxDelayMs = 5000;
    const backoffFactor = 1.2;
    let currentDelay = DELAY_MS;
    let lastFailureReason: string | null = null;

    if (INITIAL_DELAY_MS > 0) {
      await this.delay(INITIAL_DELAY_MS);
    }

    for (let attempt = 1; attempt <= retryLimit; attempt++) {
      try {
        const response = await fetchImpl(targetUrl, { method: 'GET' });
        const status = response.status;

        if (status === 200) {
          console.log(`[AI Agent] health attempt ${attempt}/${retryLimit}: HTTP ${status}`);
          console.log('[AI Agent] AI agent ready');
          return;
        }

        lastFailureReason = `HTTP ${status}`;
      } catch (error) {
        lastFailureReason = error instanceof Error ? error.message : String(error);
      }

      const reasonToReport = lastFailureReason ?? 'unknown error';
      console.log(`[AI Agent] health attempt ${attempt}/${retryLimit}: ${reasonToReport}`);

      if (attempt < retryLimit) {
        await this.delay(currentDelay);
        currentDelay = Math.min(Math.round(currentDelay * backoffFactor), maxDelayMs);
      }
    }

    const suffix = lastFailureReason ? ` Last error: ${lastFailureReason}` : '';
    throw new Error(`AI Agent failed health check after ${retryLimit} attempts.${suffix}`);
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
      console.log('[AI Agent] stopped');
    }
  }

  /**
   * Send message to AI agent and get response
   */
  async sendMessage(message: string, userId?: number, conversationId?: string): Promise<AIResponse> {
    const resolvedConversationId = await this.conversationManager.ensureConversation(
      conversationId,
      userId ?? null
    );

    await this.conversationManager.addMessage(resolvedConversationId, 'user', message, {
      userId: userId ?? null
    });

    const history = await this.conversationManager.getConversationHistory(resolvedConversationId);

    try {
      const agentResponse = this.isLocalMode
        ? await this.sendToLocalAgent(message, userId, resolvedConversationId, history)
        : await this.sendToRemoteAgent(message, userId, resolvedConversationId, history);

      await this.persistAssistantMessage(resolvedConversationId, agentResponse);

      return {
        ...agentResponse,
        conversation_id: resolvedConversationId
      };
    } catch (error) {
      if (this.shouldFallbackToGemini(error)) {
        console.warn('[AI Assistant] Primary AI agent unavailable. Falling back to direct Gemini service.');

        try {
          const fallback = await this.createGeminiFallbackResponse(message, userId);
          await this.persistAssistantMessage(resolvedConversationId, fallback);
          return {
            ...fallback,
            conversation_id: resolvedConversationId
          };
        } catch (fallbackError) {
          console.error('[AI Assistant] Gemini fallback failed:', fallbackError);
          throw new Error('AI assistant is currently unavailable. Please try again later.');
        }
      }

      await this.conversationManager.addMessage(
        resolvedConversationId,
        'assistant',
        'I encountered an error processing your request. Please try again shortly.',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );

      console.error('Error sending message to AI agent:', error);
      throw new Error('Failed to get response from AI assistant');
    }
  }

  private async persistAssistantMessage(conversationId: string, response: AIResponse): Promise<void> {
    await this.conversationManager.addMessage(
      conversationId,
      'assistant',
      response.response,
      {
        sources: response.sources,
        confidence: response.confidence,
        tool_used: response.tool_used
      }
    );

    await this.scheduleConversationSummary(conversationId, 'assistant_response');
  }

  private async scheduleConversationSummary(
    conversationId: string,
    reason: 'assistant_response' | 'manual'
  ): Promise<void> {
    try {
      await this.taskQueue.enqueueTask(
        'conversation_summary',
        { reason },
        conversationId,
        new Date(Date.now() + 2000)
      );
    } catch (error) {
      console.warn('[AI Assistant] Failed to enqueue conversation summary task:', error);
    }
  }

  /**
   * Send message to local AI agent via HTTP
   */
  private async sendToLocalAgent(
    message: string,
    userId: number | undefined,
    conversationId: string,
    history: ConversationMessage[]
  ): Promise<AIResponse> {
    try {
      const response = await axios.post(
        `${this.aiEndpoint}/chat`,
        {
          message,
          user_id: userId,
          conversation_id: conversationId,
          conversation_history: this.serializeHistory(history)
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
  private async sendToRemoteAgent(
    message: string,
    userId: number | undefined,
    conversationId: string,
    history: ConversationMessage[]
  ): Promise<AIResponse> {
    const payload = {
      message,
      user_id: userId,
      conversation_id: conversationId,
      conversation_history: this.serializeHistory(history)
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

  private resolveHealthCheckUrl(endpoint: string): string {
    if (HEALTH_URL_OVERRIDE) {
      return HEALTH_URL_OVERRIDE;
    }

    const replaced = this.replaceEndpointPath(endpoint, '/healthz');
    if (replaced) {
      return replaced;
    }

    return HEALTH_URL;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get AI agent health status
   */
  async getHealthStatus(): Promise<{ status: string; details?: any }> {
    try {
      const healthUrl = this.aiHealthUrl ?? this.resolveHealthCheckUrl(this.aiEndpoint);
      console.log(`🔍 Health check: Attempting to access ${healthUrl}`);

      const response = await axios.get(
        healthUrl,
        this.createRequestConfig({
          timeout: 5000,
          validateStatus: () => true
        })
      );

      const healthData = response.data ?? {};
      console.log(`✅ Health check response ${response.status} - ${JSON.stringify(healthData)}`);

      const statusCode = response.status;
      const bodyStatus = typeof healthData.status === 'string' ? healthData.status.toLowerCase() : undefined;
      let normalizedStatus: string;

      if (statusCode === 200 && bodyStatus === 'ok') {
        normalizedStatus = 'healthy';
      } else if (bodyStatus === 'starting' || bodyStatus === 'initializing') {
        normalizedStatus = 'initializing';
      } else {
        normalizedStatus = statusCode === 200 ? bodyStatus ?? 'healthy' : 'unhealthy';
      }

      const details =
        typeof healthData === 'object' && healthData !== null
          ? { ...(healthData as Record<string, unknown>), httpStatus: statusCode }
          : { httpStatus: statusCode, body: healthData };

      return {
        status: normalizedStatus,
        details
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
    const messages = await this.conversationManager.getConversationHistory(conversationId, 200);

    return messages.map(message => ({
      id: message.id,
      text: message.content,
      isUser: message.role === 'user',
      timestamp: message.createdAt,
      sources: Array.isArray(message.metadata?.sources as string[])
        ? (message.metadata?.sources as string[])
        : undefined,
      confidence:
        typeof message.metadata?.confidence === 'number'
          ? (message.metadata?.confidence as number)
          : undefined,
      toolUsed:
        typeof message.metadata?.tool_used === 'string'
          ? (message.metadata?.tool_used as string)
          : undefined,
      metadata: message.metadata
    }));
  }

  /**
   * Clear conversation history
   */
  async clearConversationHistory(conversationId: string): Promise<void> {
    await this.conversationManager.clearConversation(conversationId);
  }

  /**
   * Get AI agent statistics
   */
  async getStatistics(): Promise<any> {
    const conversationStats = await this.conversationManager.getStatistics();
    const statsWithLegacyKeys = {
      total_conversations: conversationStats.totalConversations,
      total_messages: conversationStats.totalMessages,
      active_conversations: conversationStats.activeConversations
    };

    if (!this.isLocalMode) {
      return statsWithLegacyKeys;
    }

    try {
      const response = await axios.get(
        `${this.aiEndpoint}/stats`,
        this.createRequestConfig()
      );
      return {
        ...response.data,
        ...statsWithLegacyKeys
      };
    } catch (error) {
      console.error('Failed to get AI agent statistics:', error);
      return statsWithLegacyKeys;
    }
  }

  private isLocalEndpoint(endpoint: string): boolean {
    try {
      const url = new URL(endpoint);
      const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
      return localHosts.has(url.hostname);
    } catch (error) {
      console.warn('[AI Assistant] Unable to parse AI endpoint URL:', error);
      return false;
    }
  }

  private isRemoteEndpoint(endpoint: string): boolean {
    if (!endpoint) {
      return false;
    }

    if (endpoint.startsWith('/')) {
      return true;
    }

    try {
      return !this.isLocalEndpoint(endpoint);
    } catch (error) {
      console.warn('[AI Assistant] Unable to determine if endpoint is remote:', error);
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

  getEndpointInfo(): { endpoint: string; healthUrl: string | null; mode: 'local' | 'remote' } {
    const healthUrl = this.aiHealthUrl ?? this.resolveHealthCheckUrl(this.aiEndpoint);
    return {
      endpoint: this.aiEndpoint,
      healthUrl,
      mode: this.isLocalMode ? 'local' : 'remote',
    };
  }

  private serializeHistory(history: ConversationMessage[]): any[] {
    return history.map(message => ({
      id: message.id,
      text: message.content,
      is_user: message.role === 'user',
      isUser: message.role === 'user',
      timestamp: message.createdAt.toISOString(),
      metadata: message.metadata ?? {}
    }));
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
      tool_used: 'gemini_direct',
      actions: [],
      action_message: null,
      action_catalog: []
    };
  }

  async refreshSchema(reason?: string): Promise<{ schema_version: string; schema_hash: string; refreshed_at: string }> {
    const payload = reason ? { reason } : {};
    const headers: Record<string, string> = {};
    const secret = sanitizeEnvValue(process.env.AI_SCHEMA_REFRESH_SECRET);
    if (secret) {
      headers['x-refresh-secret'] = secret;
    }

    try {
      const response = await axios.post(
        `${this.aiEndpoint}/schema/refresh`,
        payload,
        this.createRequestConfig({
          timeout: 15000,
          headers
        })
      );
      return response.data;
    } catch (error) {
      console.error('[AI Assistant] Schema refresh request failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const aiAssistantService = new AIAssistantService();
export default aiAssistantService;
