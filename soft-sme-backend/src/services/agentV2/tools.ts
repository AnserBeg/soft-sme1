import { Pool } from 'pg';
import { SalesOrderService } from '../SalesOrderService';
import { EmailService } from '../emailService';
import { PDFService } from '../pdfService';
import { AgentTaskEvent, AgentTaskFacade } from './AgentTaskFacade';
import type { EntityType } from './geminiRouter';
import type {
  ToolResultEnvelope,
  ToolAttemptMetadata,
  ToolDisambiguationCandidate,
} from './answerComposer';
import { VoiceService } from '../voice/VoiceService';
import { TaskInput, TaskStatus } from '../TaskService';
import { QuoteService } from '../QuoteService';
import { PurchaseOrderService } from '../PurchaseOrderService';
import DocumentEmailService from '../DocumentEmailService';
import { AgentEmailService } from '../agentEmail/service';
import type { ComposeEmailAttachmentPayload } from '../agentEmail/types';
import {
  withTransaction,
  idempotentWrite,
  extractIdempotencyKeyFromArgs,
  IdempotencyError,
} from '../../lib/idempotency';
import type { IdempotentWriteResult } from '../../lib/idempotency';
import { AgentAnalyticsLogger } from './analyticsLogger';
import { queryDocsRag } from '../../services/ragClient';
import { canonicalizeName, canonicalizePartNumber } from '../../lib/normalize';
import { getCanonicalConfig, getFuzzyConfig } from '../../config';

type ProcessingResult = { status: 'processing' };

interface TaskCreateDeterministicResult {
  id: number;
  status: TaskStatus;
}

type FuzzyEntityType = 'customer' | 'vendor' | 'part';

interface FuzzyEntityMatch {
  id: number;
  label: string;
  score: number;
  extra: Record<string, unknown>;
}

interface TaskUpdateDeterministicResult {
  id: number;
  updated: true;
  status: TaskStatus;
}

interface TaskMessageDeterministicResult {
  task_id: number;
  message_id: number;
}

function isProcessingResult(value: unknown): value is ProcessingResult {
  return Boolean(value && typeof value === 'object' && (value as any).status === 'processing');
}

function isTaskCreateDeterministicResult(value: unknown): value is TaskCreateDeterministicResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as any).id === 'number' &&
      typeof (value as any).status === 'string'
  );
}

function isTaskUpdateDeterministicResult(value: unknown): value is TaskUpdateDeterministicResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as any).id === 'number' &&
      (value as any).updated === true &&
      typeof (value as any).status === 'string'
  );
}

function isTaskMessageDeterministicResult(value: unknown): value is TaskMessageDeterministicResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as any).task_id === 'number' &&
      typeof (value as any).message_id === 'number'
  );
}

export class AgentToolsV2 {
  private soService: SalesOrderService;
  private emailService: EmailService;
  private pdfService: PDFService;
  private taskFacade: AgentTaskFacade;
  private voiceService: VoiceService;
  private quoteService: QuoteService;
  private purchaseOrderService: PurchaseOrderService;
  private documentEmailService: DocumentEmailService;
  private agentEmailService?: AgentEmailService;
  private analytics: AgentAnalyticsLogger;
  private internalApiBaseUrl: string;
  constructor(private pool: Pool) {
    this.soService = new SalesOrderService(pool);
    this.emailService = new EmailService(pool);
    this.pdfService = new PDFService(pool);
    this.taskFacade = new AgentTaskFacade(pool);
    this.voiceService = new VoiceService(pool);
    this.quoteService = new QuoteService(pool);
    this.purchaseOrderService = new PurchaseOrderService(pool);
    this.documentEmailService = new DocumentEmailService(pool, this.emailService, this.pdfService);
    this.analytics = new AgentAnalyticsLogger(pool);
    this.internalApiBaseUrl = this.resolveInternalApiBaseUrl();
  }

  async fuzzyResolveEntity(
    sessionId: number,
    args: { entityType: FuzzyEntityType; query: string; minScore?: number }
  ): Promise<{ matches: FuzzyEntityMatch[] }> {
    const entityType = args?.entityType;
    if (entityType !== 'customer' && entityType !== 'vendor' && entityType !== 'part') {
      throw new Error('entityType must be one of customer, vendor, or part');
    }

    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('query is required for fuzzyResolveEntity');
    }

    const matches = await this.performFuzzyEntitySearch({
      entityType,
      query,
      minScore: args?.minScore,
    });

    const canonical = this.canonicalizeEntityQuery(entityType, query);
    this.logEntityResolutionAttempt(entityType, 'tool_query', {
      sessionId,
      query,
      canonical,
      score: matches[0]?.score ?? null,
      candidateCount: matches.length,
    });

    return { matches };
  }

  private resolveInternalApiBaseUrl(): string {
    const candidateEnvs = [
      process.env.AGENT_INTERNAL_API_BASE_URL,
      process.env.INTERNAL_API_BASE_URL,
      process.env.API_BASE_URL,
    ];

    for (const value of candidateEnvs) {
      if (typeof value !== 'string') {
        continue;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      if (/^https?:\/\//i.test(trimmed)) {
        return trimmed.replace(/\/+$/, '');
      }
    }

    const port = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0 ? process.env.PORT.trim() : '3000';
    return `http://127.0.0.1:${port}`;
  }

  private buildInternalApiUrl(path: string): URL {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return new URL(normalizedPath, this.internalApiBaseUrl);
  }

  private canonicalizeEntityQuery(entityType: FuzzyEntityType, value: string): string {
    switch (entityType) {
      case 'part':
        return canonicalizePartNumber(value);
      case 'customer':
      case 'vendor':
      default:
        return canonicalizeName(value);
    }
  }

  private logEntityResolutionAttempt(
    entityType: FuzzyEntityType,
    strategy: string,
    metadata: {
      sessionId?: number;
      query?: string;
      canonical?: string;
      score?: number | null;
      candidateCount?: number;
    }
  ): void {
    const { sessionId, ...rest } = metadata;
    void this.analytics
      .logEvent({
        source: 'orchestrator',
        sessionId,
        tool: 'entity_resolution',
        eventType: 'entity_resolution',
        status: strategy,
        metadata: {
          entity_type: entityType,
          ...rest,
        },
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.debug('agentV2 entity resolution analytics error', error);
        }
      });
  }

  private async performFuzzyEntitySearch(params: {
    entityType: FuzzyEntityType;
    query: string;
    minScore?: number;
  }): Promise<FuzzyEntityMatch[]> {
    const trimmedQuery = typeof params.query === 'string' ? params.query.trim() : '';
    if (!trimmedQuery) {
      return [];
    }

    const canonicalQuery = this.canonicalizeEntityQuery(params.entityType, trimmedQuery);
    if (!canonicalQuery) {
      return [];
    }

    const target = this.buildInternalApiUrl('/api/search/fuzzy');
    const { maxResults } = getFuzzyConfig();
    target.searchParams.set('type', params.entityType);
    target.searchParams.set('q', canonicalQuery);
    target.searchParams.set('limit', String(maxResults));
    if (typeof params.minScore === 'number' && Number.isFinite(params.minScore)) {
      target.searchParams.set('minScore', String(params.minScore));
    }

    const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
    if (!fetchFn) {
      throw new Error('Fuzzy entity search failed: fetch is not available in this environment');
    }

    let response: globalThis.Response;
    try {
      response = await fetchFn(target, {
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new Error(`Fuzzy entity search failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Fuzzy entity search failed with status ${response.status}: ${body || response.statusText}`
      );
    }

    const json = (await response.json().catch(() => ({}))) as {
      matches?: Array<Record<string, unknown>>;
    };

    const matches = Array.isArray(json.matches) ? json.matches.slice(0, 5) : [];

    return matches
      .map((match): FuzzyEntityMatch | null => {
        const rawId = (match as any)?.id;
        const numericId = typeof rawId === 'number' ? rawId : Number(rawId);
        if (!Number.isFinite(numericId)) {
          return null;
        }

        const labelValue = (match as any)?.label;
        const label = typeof labelValue === 'string' ? labelValue : String(labelValue ?? numericId);
        const scoreValue = (match as any)?.score;
        const score = typeof scoreValue === 'number' ? scoreValue : Number(scoreValue ?? 0);
        const extraValue = (match as any)?.extra;
        const extra = extraValue && typeof extraValue === 'object' ? (extraValue as Record<string, unknown>) : {};

        return {
          id: numericId,
          label,
          score: Number.isFinite(score) ? score : 0,
          extra,
        };
      })
      .filter((match): match is FuzzyEntityMatch => Boolean(match));
  }

  private getAgentEmailService(): AgentEmailService {
    if (!this.agentEmailService) {
      this.agentEmailService = new AgentEmailService(this.pool);
    }
    return this.agentEmailService;
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

  private normalizeRecipients(value: any): string[] {
    if (value == null) {
      return [];
    }

    const source = Array.isArray(value) ? value : [value];
    return source
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
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

  private normalizeLookupType(value: any): EntityType | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    switch (normalized) {
      case 'vendor':
      case 'customer':
      case 'part':
      case 'purchase_order':
      case 'sales_order':
      case 'quote':
        return normalized as EntityType;
      default:
        return null;
    }
  }

  private normalizeLookupValue(value: any): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeNumericId(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private extractNonEmptyString(value: any): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private buildLikeTerm(value: string): string {
    if (!value) {
      return '%';
    }
    return `%${value.replace(/\s+/g, '%')}%`;
  }

  private recordIdempotencyResult(
    sessionId: number,
    didRunWork: boolean,
    result: IdempotentWriteResult<unknown>
  ): void {
    if (didRunWork) {
      void this.analytics.incrementCounter(sessionId, 'idempotency.first_run.count');
    } else if (!isProcessingResult(result)) {
      void this.analytics.incrementCounter(sessionId, 'idempotency.replay.count');
    }
  }

  private recordIdempotencyConflict(sessionId: number, error: unknown): void {
    if (error instanceof IdempotencyError && error.statusCode === 409) {
      void this.analytics.incrementCounter(sessionId, 'idempotency.conflict.count');
    }
  }

  private async resolveCustomerIdFromPayload(payload: any, sessionId?: number): Promise<number> {
    const directCandidates: any[] = [];
    const addCandidate = (candidate: any) => {
      if (candidate !== undefined && candidate !== null) {
        directCandidates.push(candidate);
      }
    };

    addCandidate(payload?.customer_id);
    addCandidate(payload?.customerId);

    const traverseCustomer = (source: any, depth = 0) => {
      if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) {
        return;
      }

      Object.entries(source).forEach(([key, value]) => {
        const lower = key.toLowerCase();
        if (lower.includes('id')) {
          addCandidate(value);
        }
        if (lower.includes('name') || lower.includes('customer')) {
          addNameCandidate(value);
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          traverseCustomer(value, depth + 1);
        }
      });
    };

    const nameCandidates = new Map<string, string>();
    const addNameCandidate = (value: any) => {
      const extracted = this.extractNonEmptyString(value);
      if (!extracted) {
        return;
      }

      const canonical = this.canonicalizeEntityQuery('customer', extracted);
      if (!canonical) {
        return;
      }

      if (!nameCandidates.has(canonical)) {
        nameCandidates.set(canonical, extracted);
      }
    };

    addNameCandidate(payload?.customer_name);
    addNameCandidate(payload?.customerName);
    if (typeof payload?.customer === 'string') {
      addNameCandidate(payload.customer);
    }

    const customerObject = payload?.customer && typeof payload.customer === 'object' ? payload.customer : null;
    if (customerObject) {
      traverseCustomer(customerObject);
    }

    const { minScoreAuto, minScoreShow } = getFuzzyConfig();

    for (const candidate of directCandidates) {
      const normalized = this.normalizeNumericId(candidate);
      if (normalized !== null) {
        this.logEntityResolutionAttempt('customer', 'numeric_id', {
          sessionId,
          candidateCount: 1,
          score: null,
        });
        return normalized;
      }
    }

    let lastLowConfidence: { original: string; canonical: string; matches: FuzzyEntityMatch[]; topScore: number } | null = null;
    let lastNoCandidateQuery: string | null = null;

    for (const [canonical, original] of nameCandidates) {
      const matches = await this.performFuzzyEntitySearch({ entityType: 'customer', query: canonical });
      const candidateCount = matches.length;

      if (!candidateCount) {
        this.logEntityResolutionAttempt('customer', 'no_candidates', {
          sessionId,
          query: original,
          canonical,
          score: null,
          candidateCount: 0,
        });
        lastNoCandidateQuery = original;
        continue;
      }

      const top = matches[0];
      const topScore = Number.isFinite(top?.score) ? top.score : 0;

      if (topScore >= minScoreAuto) {
        this.logEntityResolutionAttempt('customer', 'fuzzy_auto', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        return top.id;
      }

      if (topScore >= minScoreShow) {
        this.logEntityResolutionAttempt('customer', 'fuzzy_disambiguate', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        const suggestions = matches
          .slice(0, 3)
          .map((match) => this.formatFuzzyCandidate('customer', match))
          .join('; ');
        const suffix = suggestions ? ` Top matches: ${suggestions}.` : '';
        throw new Error(
          `Multiple customers match "${original}".${suffix} Please provide the customer ID or refine the name.`
        );
      }

      this.logEntityResolutionAttempt('customer', 'fuzzy_refine', {
        sessionId,
        query: original,
        canonical,
        score: topScore,
        candidateCount,
      });
      lastLowConfidence = { original, canonical, matches, topScore };
    }

    if (lastLowConfidence) {
      const top = lastLowConfidence.matches[0];
      const suggestion = top
        ? ` Closest match: ${this.formatFuzzyCandidate('customer', top)} (score ${top.score.toFixed(2)}).`
        : '';
      throw new Error(
        `I found only low-confidence customer matches for "${lastLowConfidence.original}".${suggestion} ` +
          'Please refine the customer details or provide the customer ID.'
      );
    }

    if (lastNoCandidateQuery) {
      throw new Error(
        `No customers matched "${lastNoCandidateQuery}". Please refine the customer details or provide the customer ID.`
      );
    }

    throw new Error(
      'Unable to resolve the customer from the provided information. Please supply the numeric customer ID.'
    );
  }

  private async resolveVendorIdFromPayload(payload: any, sessionId?: number): Promise<number> {
    const directCandidates: any[] = [];
    const addCandidate = (candidate: any) => {
      if (candidate !== undefined && candidate !== null) {
        directCandidates.push(candidate);
      }
    };

    addCandidate(payload?.vendor_id);
    addCandidate(payload?.vendorId);

    const nameCandidates = new Map<string, string>();
    const addNameCandidate = (value: any) => {
      const extracted = this.extractNonEmptyString(value);
      if (!extracted) {
        return;
      }
      const canonical = this.canonicalizeEntityQuery('vendor', extracted);
      if (!canonical) {
        return;
      }
      if (!nameCandidates.has(canonical)) {
        nameCandidates.set(canonical, extracted);
      }
    };

    addNameCandidate(payload?.vendor_name);
    addNameCandidate(payload?.vendorName);
    if (typeof payload?.vendor === 'string') {
      addNameCandidate(payload.vendor);
    }

    const traverseVendor = (source: any, depth = 0) => {
      if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) {
        return;
      }

      Object.entries(source).forEach(([key, value]) => {
        const lower = key.toLowerCase();
        if (lower.includes('id')) {
          addCandidate(value);
        }
        if (lower.includes('name') || lower.includes('vendor')) {
          addNameCandidate(value);
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          traverseVendor(value, depth + 1);
        }
      });
    };

    const vendorObject = payload?.vendor && typeof payload.vendor === 'object' ? payload.vendor : null;
    if (vendorObject) {
      traverseVendor(vendorObject);
    }

    const { minScoreAuto, minScoreShow } = getFuzzyConfig();

    for (const candidate of directCandidates) {
      const normalized = this.normalizeNumericId(candidate);
      if (normalized !== null) {
        this.logEntityResolutionAttempt('vendor', 'numeric_id', {
          sessionId,
          candidateCount: 1,
          score: null,
        });
        return normalized;
      }
    }

    let lastLowConfidence: { original: string; canonical: string; matches: FuzzyEntityMatch[]; topScore: number } | null = null;
    let lastNoCandidateQuery: string | null = null;

    for (const [canonical, original] of nameCandidates) {
      const matches = await this.performFuzzyEntitySearch({ entityType: 'vendor', query: canonical });
      const candidateCount = matches.length;

      if (!candidateCount) {
        this.logEntityResolutionAttempt('vendor', 'no_candidates', {
          sessionId,
          query: original,
          canonical,
          score: null,
          candidateCount: 0,
        });
        lastNoCandidateQuery = original;
        continue;
      }

      const top = matches[0];
      const topScore = Number.isFinite(top?.score) ? top.score : 0;

      if (topScore >= minScoreAuto) {
        this.logEntityResolutionAttempt('vendor', 'fuzzy_auto', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        return top.id;
      }

      if (topScore >= minScoreShow) {
        this.logEntityResolutionAttempt('vendor', 'fuzzy_disambiguate', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        const suggestions = matches
          .slice(0, 3)
          .map((match) => this.formatFuzzyCandidate('vendor', match))
          .join('; ');
        const suffix = suggestions ? ` Top matches: ${suggestions}.` : '';
        throw new Error(
          `Multiple vendors match "${original}".${suffix} Please provide the vendor ID or refine the name.`
        );
      }

      this.logEntityResolutionAttempt('vendor', 'fuzzy_refine', {
        sessionId,
        query: original,
        canonical,
        score: topScore,
        candidateCount,
      });
      lastLowConfidence = { original, canonical, matches, topScore };
    }

    if (lastLowConfidence) {
      const top = lastLowConfidence.matches[0];
      const suggestion = top
        ? ` Closest match: ${this.formatFuzzyCandidate('vendor', top)} (score ${top.score.toFixed(2)}).`
        : '';
      throw new Error(
        `I found only low-confidence vendor matches for "${lastLowConfidence.original}".${suggestion} ` +
          'Please refine the vendor details or provide the vendor ID.'
      );
    }

    if (lastNoCandidateQuery) {
      throw new Error(
        `No vendors matched "${lastNoCandidateQuery}". Please refine the vendor details or provide the vendor ID.`
      );
    }

    throw new Error('Unable to resolve the vendor from the provided information. Please supply the numeric vendor ID.');
  }

  private async resolvePartIdFromPayload(payload: any, sessionId?: number): Promise<number> {
    const directCandidates: any[] = [];
    const addCandidate = (candidate: any) => {
      if (candidate !== undefined && candidate !== null) {
        directCandidates.push(candidate);
      }
    };

    addCandidate(payload?.part_id);
    addCandidate(payload?.partId);
    addCandidate(payload?.inventory_id);
    addCandidate(payload?.inventoryId);

    const identifierCandidates = new Map<string, string>();
    const addIdentifierCandidate = (value: any) => {
      const extracted = this.extractNonEmptyString(value);
      if (!extracted) {
        return;
      }
      const canonical = this.canonicalizeEntityQuery('part', extracted);
      if (!canonical) {
        return;
      }
      if (!identifierCandidates.has(canonical)) {
        identifierCandidates.set(canonical, extracted);
      }
    };

    addIdentifierCandidate(payload?.part_number);
    addIdentifierCandidate(payload?.partNumber);
    addIdentifierCandidate(payload?.part_identifier);
    addIdentifierCandidate(payload?.partIdentifier);
    if (typeof payload?.part === 'string') {
      addIdentifierCandidate(payload.part);
    }
    if (typeof payload?.part_number === 'number') {
      addIdentifierCandidate(String(payload.part_number));
    }

    const traversePart = (source: any, depth = 0) => {
      if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) {
        return;
      }

      Object.entries(source).forEach(([key, value]) => {
        const lower = key.toLowerCase();
        if (lower.includes('id') && !lower.includes('description')) {
          addCandidate(value);
        }
        if (lower.includes('part') || lower.includes('item') || lower.includes('number')) {
          addIdentifierCandidate(value);
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          traversePart(value, depth + 1);
        }
      });
    };

    const partObject = payload?.part && typeof payload.part === 'object' ? payload.part : null;
    if (partObject) {
      traversePart(partObject);
    }

    const { minScoreAuto, minScoreShow } = getFuzzyConfig();
    const { enforceUniquePart } = getCanonicalConfig();

    for (const candidate of directCandidates) {
      const normalized = this.normalizeNumericId(candidate);
      if (normalized !== null) {
        this.logEntityResolutionAttempt('part', 'numeric_id', {
          sessionId,
          candidateCount: 1,
          score: null,
        });
        return normalized;
      }
    }

    let lastLowConfidence: { original: string; canonical: string; match: FuzzyEntityMatch | null } | null = null;
    let lastNoCandidateQuery: string | null = null;

    for (const [canonical, original] of identifierCandidates) {
      const exact = await this.pool.query(
        'SELECT part_id FROM inventory WHERE canonical_part_number = $1 LIMIT 5',
        [canonical]
      );

      const exactCount = exact.rowCount ?? 0;

      if (enforceUniquePart && exactCount > 1) {
        this.logEntityResolutionAttempt('part', 'canonical_conflict', {
          sessionId,
          query: original,
          canonical,
          score: 1,
          candidateCount: exactCount,
        });
        throw new Error(
          `Multiple parts share the part number "${original}". Please provide the part ID to continue.`
        );
      }

      if (exactCount > 0) {
        const resolvedId = Number(exact.rows[0]?.part_id);
        if (Number.isFinite(resolvedId)) {
          this.logEntityResolutionAttempt('part', 'canonical_exact', {
            sessionId,
            query: original,
            canonical,
            score: 1,
            candidateCount: exactCount || 1,
          });
          return resolvedId;
        }
      }

      const matches = await this.performFuzzyEntitySearch({ entityType: 'part', query: canonical });
      const candidateCount = matches.length;

      if (!candidateCount) {
        this.logEntityResolutionAttempt('part', 'no_candidates', {
          sessionId,
          query: original,
          canonical,
          score: null,
          candidateCount: 0,
        });
        lastNoCandidateQuery = original;
        continue;
      }

      const top = matches[0];
      const topScore = Number.isFinite(top?.score) ? top.score : 0;

      if (topScore >= minScoreAuto) {
        this.logEntityResolutionAttempt('part', 'fuzzy_auto', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        return top.id;
      }

      if (topScore >= minScoreShow) {
        this.logEntityResolutionAttempt('part', 'fuzzy_disambiguate', {
          sessionId,
          query: original,
          canonical,
          score: topScore,
          candidateCount,
        });
        const suggestions = matches
          .slice(0, 3)
          .map((match) => this.formatFuzzyCandidate('part', match))
          .join('; ');
        const suffix = suggestions ? ` Top matches: ${suggestions}.` : '';
        throw new Error(
          `Multiple parts match "${original}".${suffix} Please provide the part ID or refine the part number.`
        );
      }

      this.logEntityResolutionAttempt('part', 'fuzzy_refine', {
        sessionId,
        query: original,
        canonical,
        score: topScore,
        candidateCount,
      });

      lastLowConfidence = { original, canonical, match: matches.length ? matches[0] : null };
    }

    if (lastLowConfidence) {
      const suggestion = lastLowConfidence.match
        ? ` Closest match: ${this.formatFuzzyCandidate('part', lastLowConfidence.match)} (score ${lastLowConfidence.match.score.toFixed(2)}).`
        : '';
      throw new Error(
        `I found only low-confidence part matches for "${lastLowConfidence.original}".${suggestion} ` +
          'Please refine the part number or provide the part ID.'
      );
    }

    if (lastNoCandidateQuery) {
      throw new Error(
        `No parts matched "${lastNoCandidateQuery}". Please refine the part details or provide the part ID.`
      );
    }

    throw new Error('Unable to resolve the part from the provided information. Please supply the numeric part ID.');
  }

  private describeLookup(entityLabel: string, values: string[]): string {
    if (!values.length) {
      return `No ${entityLabel} found.`;
    }

    if (values.length === 1) {
      return `Found ${entityLabel} ${values[0]}.`;
    }

    const preview = values.slice(0, 3).join(', ');
    const remaining = values.length > 3 ? `, plus ${values.length - 3} more` : '';
    const plural = entityLabel.endsWith('s') ? entityLabel : `${entityLabel}s`;
    return `Found ${values.length} ${plural}: ${preview}${remaining}.`;
  }

  private formatFuzzyCandidate(entityType: FuzzyEntityType, match: FuzzyEntityMatch): string {
    const label = typeof match.label === 'string' ? match.label.trim() : String(match.id);
    const extras: string[] = [];
    const { extra } = match;

    if (entityType === 'customer' || entityType === 'vendor') {
      const city = typeof extra.city === 'string' ? extra.city.trim() : '';
      const province = typeof extra.province === 'string' ? extra.province.trim() : '';
      const country = typeof extra.country === 'string' ? extra.country.trim() : '';
      const location = [city, province, country].filter((value) => value.length > 0).join(', ');
      if (location) {
        extras.push(location);
      }
    } else if (entityType === 'part') {
      const description = typeof extra.description === 'string' ? extra.description.trim() : '';
      const unit = typeof extra.unit === 'string' ? extra.unit.trim() : '';
      const partType = typeof extra.partType === 'string' ? extra.partType.trim() : '';
      if (description) {
        extras.push(description);
      }
      if (unit) {
        extras.push(unit);
      }
      if (partType) {
        extras.push(partType);
      }
    }

    const details = extras.length ? ` – ${extras.join(' · ')}` : '';
    return `${label} (#${match.id})${details}`;
  }

  private formatVendorSummary(row: any): string {
    const name = row.vendor_name || row.name || 'Unknown vendor';
    const details = [row.contact_person, row.telephone_number, row.email]
      .map((item: any) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item: string) => item.length > 0)
      .join(' · ');
    return details ? `${name} (${details})` : name;
  }

  private formatCustomerSummary(row: any): string {
    const name = row.customer_name || row.name || 'Unknown customer';
    const details = [row.contact_person, row.telephone_number, row.email]
      .map((item: any) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item: string) => item.length > 0)
      .join(' · ');
    return details ? `${name} (${details})` : name;
  }

  private formatPartSummary(row: any): string {
    const partNumber = row.part_number || row.part_id || 'Unknown part';
    const description = typeof row.part_description === 'string' ? row.part_description.trim() : '';
    const quantity = row.quantity_on_hand != null ? Number(row.quantity_on_hand) : null;
    const quantityText = Number.isFinite(quantity) ? `qty ${quantity}` : '';
    const details = [description, quantityText].filter((item) => item && item.length > 0).join(' · ');
    return details ? `${partNumber} (${details})` : String(partNumber);
  }

  private formatPurchaseOrderSummary(row: any): string {
    const number = row.purchase_number || row.purchase_id || 'PO';
    const vendor = typeof row.vendor_name === 'string' ? row.vendor_name.trim() : '';
    const status = typeof row.status === 'string' ? row.status.trim() : '';
    const details = [vendor, status].filter((item) => item.length > 0).join(' · ');
    return details ? `${number} (${details})` : String(number);
  }

  private formatSalesOrderSummary(row: any): string {
    const number = row.sales_order_number || row.sales_order_id || 'SO';
    const customer = typeof row.customer_name === 'string' ? row.customer_name.trim() : '';
    const status = typeof row.status === 'string' ? row.status.trim() : '';
    const details = [customer, status].filter((item) => item.length > 0).join(' · ');
    return details ? `${number} (${details})` : String(number);
  }

  private formatQuoteSummary(row: any): string {
    const number = row.quote_number || row.quote_id || 'Quote';
    const customer = typeof row.customer_name === 'string' ? row.customer_name.trim() : '';
    const status = typeof row.status === 'string' ? row.status.trim() : '';
    const details = [customer, status].filter((item) => item.length > 0).join(' · ');
    return details ? `${number} (${details})` : String(number);
  }

  private defaultAttempts(): ToolAttemptMetadata {
    return { exact: false, fuzzy: false, schema_refreshed: false };
  }

  private buildLookupQueryMetadata(
    entityType: EntityType | null,
    entityName: string,
    orderNumber: string,
    partIdentifier: string,
    filters: Array<Record<string, unknown>>
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      entity_type: entityType,
      entity_name: entityName || null,
      order_number: orderNumber || null,
      filters,
    };

    if (partIdentifier) {
      metadata.part_identifier = partIdentifier;
    }

    return metadata;
  }

  private buildErrorEnvelope(
    query: Record<string, unknown>,
    code: string,
    message: string,
    attempts?: ToolAttemptMetadata
  ): ToolResultEnvelope {
    return {
      type: 'error',
      source: 'database',
      query,
      attempts: attempts ?? this.defaultAttempts(),
      error: { code, message },
    };
  }

  private buildEmptyEnvelope(
    query: Record<string, unknown>,
    attempts: ToolAttemptMetadata
  ): ToolResultEnvelope {
    return {
      type: 'empty',
      source: 'database',
      query,
      attempts,
    };
  }

  private buildSuccessEnvelope(
    query: Record<string, unknown>,
    rows: any[],
    attempts: ToolAttemptMetadata
  ): ToolResultEnvelope {
    return {
      type: 'success',
      source: 'database',
      query,
      rows,
      total_rows: rows.length,
      attempts,
    };
  }

  private buildDisambiguationEnvelope(
    query: Record<string, unknown>,
    candidates: ToolDisambiguationCandidate[],
    attempts: ToolAttemptMetadata
  ): ToolResultEnvelope {
    return {
      type: 'disambiguation',
      source: 'database',
      query,
      candidates,
      attempts,
    };
  }

  // Utility to audit tool execution
  private async audit(sessionId: number, tool: string, input: any, output: any, success = true) {
    await this.pool.query(
      'INSERT INTO agent_tool_invocations (session_id, tool, input, output, success) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, tool, input ? JSON.stringify(input) : null, output ? JSON.stringify(output) : null, success]
    );
  }

  // RAG: simple keyword search over agent_docs for now
  async retrieveDocs(sessionId: number, query: string, k = 5) {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) {
      await this.analytics.incrementCounter(sessionId, 'docs.none');
      return { type: 'docs', info: 'No documentation coverage found.', chunks: [], citations: [] };
    }

    if (process.env.DOCS_RAG_MODE === 'python') {
      const topK = Number(process.env.DOCS_RAG_TOP_K) || 5;
      try {
        const result = await queryDocsRag(trimmed, topK);
        if (result?.answer && Array.isArray(result.citations) && result.citations.length > 0) {
          await this.analytics.incrementCounter(sessionId, 'docs.rag.used');
          return {
            type: 'docs' as const,
            info: result.answer,
            chunks: Array.isArray(result.chunks) ? result.chunks : [],
            citations: result.citations,
          };
        }
      } catch (error) {
        // fall back to legacy path if enabled
      }
    }

    if (process.env.DOCS_LEGACY_SQL_FALLBACK === 'true') {
      const terms = trimmed.split(/\s+/).filter(Boolean).slice(0, 6);
      await this.analytics.incrementCounter(sessionId, 'docs.legacy.used');
      if (!terms.length) {
        await this.analytics.incrementCounter(sessionId, 'docs.none');
        return { type: 'docs', info: 'No documentation coverage found.', chunks: [], citations: [] };
      }
      const like = terms.map((_, i) => `chunk ILIKE $${i + 1}`).join(' OR ');
      const params = terms.map((t) => `%${t}%`);
      const res = await this.pool.query(
        `SELECT path, section, chunk FROM agent_docs WHERE ${like} LIMIT ${k}`,
        params
      );
      if (!res.rows.length) {
        await this.analytics.incrementCounter(sessionId, 'docs.none');
      }
      return {
        type: 'docs',
        info: res.rows.length ? 'Relevant docs' : 'No documentation coverage found.',
        chunks: res.rows,
        citations: [],
      };
    }

    await this.analytics.incrementCounter(sessionId, 'docs.none');
    return { type: 'docs', info: 'No documentation coverage found.', chunks: [], citations: [] };
  }

  async inventoryLookup(sessionId: number, args: any): Promise<ToolResultEnvelope> {
    const entityType = this.normalizeLookupType(args?.entity_type);
    const entityName = this.normalizeLookupValue(args?.entity_name);
    const orderNumber = this.normalizeLookupValue(args?.order_number);
    const partIdentifier = this.normalizeLookupValue(args?.part_identifier);
    const filters = Array.isArray(args?.filters) ? args.filters : [];

    const payload = {
      entity_type: entityType,
      entity_name: entityName,
      order_number: orderNumber,
      part_identifier: partIdentifier,
      filters,
    };

    const queryMetadata = this.buildLookupQueryMetadata(entityType, entityName, orderNumber, partIdentifier, filters);

    try {
      let result: ToolResultEnvelope;
      switch (entityType) {
        case 'vendor':
          result = await this.lookupVendors(entityName, queryMetadata);
          break;
        case 'customer':
          result = await this.lookupCustomers(entityName, queryMetadata);
          break;
        case 'part':
          result = await this.lookupParts(partIdentifier || entityName, queryMetadata);
          break;
        case 'purchase_order':
          result = await this.lookupPurchaseOrders(orderNumber, entityName, queryMetadata);
          break;
        case 'sales_order':
          result = await this.lookupSalesOrders(orderNumber, entityName, queryMetadata);
          break;
        case 'quote':
          result = await this.lookupQuotes(orderNumber, entityName, queryMetadata);
          break;
        default:
          result = this.buildErrorEnvelope(
            queryMetadata,
            'INVALID_REQUEST',
            'Please specify what you want to look up (vendor, customer, part, purchase order, sales order, or quote).'
          );
      }

      await this.audit(sessionId, 'inventoryLookup', payload, result, true);
      return result;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Inventory lookup failed';
      await this.audit(sessionId, 'inventoryLookup', payload, { error: message }, false);
      throw error;
    }
  }

  private async lookupVendors(name: string, query: Record<string, unknown>): Promise<ToolResultEnvelope> {
    const attempts = this.defaultAttempts();

    if (!name) {
      return this.buildErrorEnvelope(query, 'MISSING_INPUT', 'Please provide a vendor name to search for.', attempts);
    }

    attempts.exact = true;
    const exact = await this.pool.query(
      'SELECT vendor_id, vendor_name, contact_person, telephone_number, email FROM vendormaster WHERE LOWER(vendor_name) = LOWER($1)',
      [name]
    );

    let rows = exact.rows;
    if (!rows.length) {
      attempts.fuzzy = true;
      rows = (
        await this.pool.query(
          'SELECT vendor_id, vendor_name, contact_person, telephone_number, email FROM vendormaster WHERE vendor_name ILIKE $1 ORDER BY vendor_name ASC LIMIT 5',
          [this.buildLikeTerm(name)]
        )
      ).rows;
    }

    if (!rows.length) {
      return this.buildEmptyEnvelope(query, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(query, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.vendor_id,
      display_name: row.vendor_name,
      contact_person: row.contact_person,
      telephone_number: row.telephone_number,
      email: row.email,
    }));
    return this.buildDisambiguationEnvelope(query, candidates, attempts);
  }

  private async lookupCustomers(name: string, query: Record<string, unknown>): Promise<ToolResultEnvelope> {
    const attempts = this.defaultAttempts();

    if (!name) {
      return this.buildErrorEnvelope(query, 'MISSING_INPUT', 'Please provide a customer name to search for.', attempts);
    }

    attempts.exact = true;
    const exact = await this.pool.query(
      'SELECT customer_id, customer_name, contact_person, telephone_number, email FROM customermaster WHERE LOWER(customer_name) = LOWER($1)',
      [name]
    );

    let rows = exact.rows;
    if (!rows.length) {
      attempts.fuzzy = true;
      rows = (
        await this.pool.query(
          'SELECT customer_id, customer_name, contact_person, telephone_number, email FROM customermaster WHERE customer_name ILIKE $1 ORDER BY customer_name ASC LIMIT 5',
          [this.buildLikeTerm(name)]
        )
      ).rows;
    }

    if (!rows.length) {
      return this.buildEmptyEnvelope(query, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(query, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.customer_id,
      display_name: row.customer_name,
      contact_person: row.contact_person,
      telephone_number: row.telephone_number,
      email: row.email,
    }));
    return this.buildDisambiguationEnvelope(query, candidates, attempts);
  }

  private async lookupParts(identifier: string, query: Record<string, unknown>): Promise<ToolResultEnvelope> {
    const search = identifier || '';
    const attempts = this.defaultAttempts();

    if (!search) {
      return this.buildErrorEnvelope(query, 'MISSING_INPUT', 'Please provide a part number or name to search for.', attempts);
    }

    attempts.fuzzy = true;
    const rows = (
      await this.pool.query(
        'SELECT part_id, part_number, part_description, unit, quantity_on_hand, last_unit_cost FROM inventory WHERE part_number ILIKE $1 OR part_description ILIKE $1 ORDER BY part_number ASC LIMIT 5',
        [this.buildLikeTerm(search)]
      )
    ).rows;

    if (!rows.length) {
      return this.buildEmptyEnvelope(query, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(query, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.part_id,
      display_name: row.part_number || row.part_description,
      part_number: row.part_number,
      part_description: row.part_description,
      unit: row.unit,
    }));
    return this.buildDisambiguationEnvelope(query, candidates, attempts);
  }

  private async lookupPurchaseOrders(
    orderNumber: string,
    vendorName: string,
    queryMetadata: Record<string, unknown>
  ): Promise<ToolResultEnvelope> {
    const attempts = this.defaultAttempts();
    const conditions: string[] = [];
    const params: any[] = [];

    if (orderNumber) {
      conditions.push(`ph.purchase_number ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(orderNumber));
    }

    if (vendorName) {
      conditions.push(`vm.vendor_name ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(vendorName));
    }

    if (!conditions.length) {
      return this.buildErrorEnvelope(
        queryMetadata,
        'MISSING_INPUT',
        'Provide a purchase order number or vendor name to search.',
        attempts
      );
    }

    attempts.fuzzy = true;

    const query = `
      SELECT ph.purchase_id, ph.purchase_number, ph.status, ph.purchase_date, vm.vendor_name
      FROM purchasehistory ph
      LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
      WHERE ${conditions.join(' OR ')}
      ORDER BY ph.purchase_date DESC NULLS LAST, ph.purchase_number DESC
      LIMIT 5
    `;

    const rows = (await this.pool.query(query, params)).rows;

    if (!rows.length) {
      return this.buildEmptyEnvelope(queryMetadata, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(queryMetadata, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.purchase_id,
      display_name: row.purchase_number,
      vendor_name: row.vendor_name,
      status: row.status,
      purchase_date: row.purchase_date,
    }));

    return this.buildDisambiguationEnvelope(queryMetadata, candidates, attempts);
  }

  private async lookupSalesOrders(
    orderNumber: string,
    customerName: string,
    queryMetadata: Record<string, unknown>
  ): Promise<ToolResultEnvelope> {
    const attempts = this.defaultAttempts();
    const conditions: string[] = [];
    const params: any[] = [];

    if (orderNumber) {
      conditions.push(`soh.sales_order_number ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(orderNumber));
    }

    if (customerName) {
      conditions.push(`cm.customer_name ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(customerName));
    }

    if (!conditions.length) {
      return this.buildErrorEnvelope(
        queryMetadata,
        'MISSING_INPUT',
        'Provide a sales order number or customer name to search.',
        attempts
      );
    }

    attempts.fuzzy = true;

    const query = `
      SELECT soh.sales_order_id, soh.sales_order_number, soh.status, cm.customer_name, soh.product_name
      FROM salesorderhistory soh
      LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
      WHERE ${conditions.join(' OR ')}
      ORDER BY soh.sales_order_id DESC
      LIMIT 5
    `;

    const rows = (await this.pool.query(query, params)).rows;

    if (!rows.length) {
      return this.buildEmptyEnvelope(queryMetadata, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(queryMetadata, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.sales_order_id,
      display_name: row.sales_order_number,
      customer_name: row.customer_name,
      status: row.status,
      product_name: row.product_name,
    }));

    return this.buildDisambiguationEnvelope(queryMetadata, candidates, attempts);
  }

  private async lookupQuotes(
    orderNumber: string,
    customerName: string,
    queryMetadata: Record<string, unknown>
  ): Promise<ToolResultEnvelope> {
    const attempts = this.defaultAttempts();
    const conditions: string[] = [];
    const params: any[] = [];

    if (orderNumber) {
      conditions.push(`q.quote_number ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(orderNumber));
    }

    if (customerName) {
      conditions.push(`cm.customer_name ILIKE $${conditions.length + 1}`);
      params.push(this.buildLikeTerm(customerName));
    }

    if (!conditions.length) {
      return this.buildErrorEnvelope(
        queryMetadata,
        'MISSING_INPUT',
        'Provide a quote number or customer name to search.',
        attempts
      );
    }

    attempts.fuzzy = true;

    const query = `
      SELECT q.quote_id, q.quote_number, q.status, cm.customer_name, q.product_name
      FROM quotes q
      LEFT JOIN customermaster cm ON q.customer_id = cm.customer_id
      WHERE ${conditions.join(' OR ')}
      ORDER BY q.quote_id DESC
      LIMIT 5
    `;

    const rows = (await this.pool.query(query, params)).rows;

    if (!rows.length) {
      return this.buildEmptyEnvelope(queryMetadata, attempts);
    }

    if (rows.length === 1) {
      return this.buildSuccessEnvelope(queryMetadata, rows, attempts);
    }

    const candidates: ToolDisambiguationCandidate[] = rows.map((row) => ({
      id: row.quote_id,
      display_name: row.quote_number,
      customer_name: row.customer_name,
      status: row.status,
      product_name: row.product_name,
    }));

    return this.buildDisambiguationEnvelope(queryMetadata, candidates, attempts);
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
    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, event, didRunWork } = await withTransaction(this.pool, async (client) => {
        let resolvedEvent: AgentTaskEvent | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'task.create',
          tenantId: String(companyId),
          idempotencyKey,
          requestPayload: payload,
          work: async () => {
            didRunWork = true;
            const createdEvent = await this.taskFacade.createTask(
              sessionId,
              companyId,
              userId,
              {
                ...taskPayload,
                followUp,
              },
              client
            );
            resolvedEvent = createdEvent;
            return createdEvent;
          },
          buildDeterministicResult: (createdEvent) => ({
            id: createdEvent.task.id,
            status: createdEvent.task.status,
          }),
        });

        if (!resolvedEvent && isTaskCreateDeterministicResult(deterministicResult)) {
          resolvedEvent = await this.taskFacade.hydrateTaskEvent(
            'task_created',
            companyId,
            deterministicResult.id,
            {},
            client
          );
        }

        return { deterministicResult, event: resolvedEvent, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      if (!event) {
        if (isProcessingResult(deterministicResult)) {
          throw new Error('Task creation is still processing. Please retry shortly.');
        }
        throw new Error('Failed to resolve task creation result.');
      }

      await this.audit(sessionId, 'createTask', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
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

    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, event, didRunWork } = await withTransaction(this.pool, async (client) => {
        let resolvedEvent: AgentTaskEvent | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'task.update',
          tenantId: String(companyId),
          targetId: String(taskId),
          idempotencyKey,
          requestPayload: payload,
          work: async () => {
            didRunWork = true;
            const updatedEvent = await this.taskFacade.updateTask(
              sessionId,
              companyId,
              userId,
              taskId,
              updates,
              client
            );
            resolvedEvent = updatedEvent;
            return updatedEvent;
          },
          buildDeterministicResult: (updatedEvent) => ({
            id: taskId,
            updated: true,
            status: updatedEvent.task.status,
          }),
        });

        if (!resolvedEvent && isTaskUpdateDeterministicResult(deterministicResult)) {
          resolvedEvent = await this.taskFacade.hydrateTaskEvent(
            'task_updated',
            companyId,
            deterministicResult.id,
            {},
            client
          );
        }

        return { deterministicResult, event: resolvedEvent, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      if (!event) {
        if (isProcessingResult(deterministicResult)) {
          throw new Error('Task update is still processing. Please retry shortly.');
        }
        throw new Error('Failed to resolve task update result.');
      }

      await this.audit(sessionId, 'updateTask', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
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

    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, event, didRunWork } = await withTransaction(this.pool, async (client) => {
        let resolvedEvent: AgentTaskEvent | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'task.message',
          tenantId: String(companyId),
          targetId: String(taskId),
          idempotencyKey,
          requestPayload: payload,
          work: async () => {
            didRunWork = true;
            const messageEvent = await this.taskFacade.postMessage(
              sessionId,
              companyId,
              userId,
              taskId,
              contentSource,
              reason,
              client
            );
            if (!messageEvent.messageId) {
              throw new Error('Task message creation did not return a message id');
            }
            resolvedEvent = messageEvent;
            return messageEvent;
          },
          buildDeterministicResult: (messageEvent) => {
            if (!messageEvent.messageId) {
              throw new Error('Task message creation did not return a message id');
            }
            return { task_id: taskId, message_id: messageEvent.messageId };
          },
        });

        if (!resolvedEvent && isTaskMessageDeterministicResult(deterministicResult)) {
          resolvedEvent = await this.taskFacade.hydrateTaskEvent(
            'task_message',
            companyId,
            deterministicResult.task_id,
            { messageId: deterministicResult.message_id },
            client
          );
        }

        return { deterministicResult, event: resolvedEvent, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      if (!event) {
        if (isProcessingResult(deterministicResult)) {
          throw new Error('Task message is still processing. Please retry shortly.');
        }
        throw new Error('Failed to resolve task message result.');
      }

      await this.audit(sessionId, 'postTaskMessage', payload, { taskId: event.task.id }, true);
      return event;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
      await this.audit(sessionId, 'postTaskMessage', payload, { error: error?.message ?? String(error) }, false);
      throw error;
    }
  }

  // Sales Orders
  async createSalesOrder(sessionId: number, payload: any) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(this.pool, async (client) => {
        let lastWorkResult: any | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'sales_order.create',
          idempotencyKey,
          requestPayload: payload,
          work: async () => {
            didRunWork = true;
            const result = await this.soService.createSalesOrder(payload, { access_role: 'Admin' }, client);
            lastWorkResult = result;
            return result;
          },
          buildDeterministicResult: (result) => ({
            id: result.sales_order_id,
            number: result.sales_order_number,
            status: 'Open',
          }),
        });

        return { deterministicResult, workResult: lastWorkResult, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'createSalesOrder', payload, auditPayload, true);
      return deterministicResult;
    } catch (e: any) {
      this.recordIdempotencyConflict(sessionId, e);
      await this.audit(sessionId, 'createSalesOrder', payload, { error: e.message }, false);
      throw e;
    }
  }

  async updateSalesOrder(sessionId: number, salesOrderId: number, patch: any) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(patch);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(this.pool, async (client) => {
        let lastWorkResult: any | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'sales_order.update',
          targetId: String(salesOrderId),
          idempotencyKey,
          requestPayload: patch,
          work: async () => {
            didRunWork = true;
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
            lastWorkResult = { updated: true };
            return { id: salesOrderId, updated: true };
          },
          buildDeterministicResult: () => ({
            id: salesOrderId,
            updated: true,
          }),
        });

        return { deterministicResult, workResult: lastWorkResult, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'updateSalesOrder', { salesOrderId, patch }, auditPayload, true);
      return deterministicResult;
    } catch (e: any) {
      this.recordIdempotencyConflict(sessionId, e);
      await this.audit(sessionId, 'updateSalesOrder', { salesOrderId, patch }, { error: e.message }, false);
      throw e;
    }
  }

  // Purchase Orders
  async createPurchaseOrder(sessionId: number, payload: any) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(this.pool, async (client) => {
        let lastWorkResult: any | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'purchase_order.create',
          idempotencyKey,
          requestPayload: payload,
          work: async () => {
            didRunWork = true;
            const result = await this.purchaseOrderService.createPurchaseOrder(payload, client);
            lastWorkResult = {
              id: result.purchase_id,
              number: result.purchase_number,
              status: 'Open',
            };
            return lastWorkResult;
          },
          buildDeterministicResult: (result) => ({
            id: result.id ?? result.purchase_id,
            number: result.number ?? result.purchase_number,
            status: 'Open',
          }),
        });

        return { deterministicResult, workResult: lastWorkResult, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'createPurchaseOrder', payload, auditPayload, true);
      return deterministicResult;
    } catch (e: any) {
      this.recordIdempotencyConflict(sessionId, e);
      await this.audit(sessionId, 'createPurchaseOrder', payload, { error: e.message }, false);
      throw e;
    }
  }

  async updatePurchaseOrder(sessionId: number, purchaseOrderId: number, patch: any) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(patch);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(this.pool, async (client) => {
        let lastWorkResult: any | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'purchase_order.update',
          targetId: String(purchaseOrderId),
          idempotencyKey,
          requestPayload: patch,
          work: async () => {
            didRunWork = true;
            const allowed = ['vendor_id','purchase_date','subtotal','total_gst_amount','total_amount','status','sequence_number','pickup_notes','pickup_time','pickup_location','pickup_contact_person','pickup_phone','pickup_instructions'];
            const header = patch.header || {};
            if (Object.keys(header).length) {
              const fields:string[]=[]; const values:any[]=[]; let i=1;
              for (const [k,v] of Object.entries(header)) { if (allowed.includes(k) && v!==undefined && v!==null){ fields.push(`${k}=$${i++}`); values.push(v);} }
              if (fields.length){ values.push(purchaseOrderId); await client.query(`UPDATE purchasehistory SET ${fields.join(', ')}, updated_at = NOW() WHERE purchase_id = $${i}`, values); }
            }
            if (Array.isArray(patch.lineItems)) {
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
            lastWorkResult = { id: purchaseOrderId, updated: true };
            return lastWorkResult;
          },
          buildDeterministicResult: () => ({
            id: purchaseOrderId,
            updated: true,
          }),
        });

        return { deterministicResult, workResult: lastWorkResult, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'updatePurchaseOrder', { purchaseOrderId, patch }, auditPayload, true);
      return deterministicResult;
    } catch (e: any) {
      this.recordIdempotencyConflict(sessionId, e);
      await this.audit(sessionId, 'updatePurchaseOrder', { purchaseOrderId, patch }, { error: e.message }, false);
      throw e;
    }
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
    const idempotencyKey = extractIdempotencyKeyFromArgs({ purchaseId });

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(this.pool, async (client) => {
        let lastWorkResult: any | null = null;
        let didRunWork = false;
        const deterministicResult = await idempotentWrite({
          db: this.pool,
          toolName: 'purchase_order.close',
          targetId: String(purchaseId),
          idempotencyKey,
          requestPayload: { purchaseId },
          work: async () => {
            didRunWork = true;
            const current = await client.query(
              'SELECT status, closed_at FROM purchasehistory WHERE purchase_id = $1 FOR UPDATE',
              [purchaseId]
            );

            if (current.rowCount === 0) {
              throw new Error('Purchase order not found');
            }

            let closedAt = current.rows[0]?.closed_at ?? null;
            const status = current.rows[0]?.status;

            if (status !== 'Closed' || !closedAt) {
              const updateResult = await client.query(
                'UPDATE purchasehistory SET status = $1, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW() WHERE purchase_id = $2 RETURNING closed_at',
                ['Closed', purchaseId]
              );
              closedAt = updateResult.rows[0]?.closed_at ?? closedAt;
            }

            lastWorkResult = closedAt
              ? { id: purchaseId, status: 'Closed', closed_at: closedAt }
              : { id: purchaseId, status: 'Closed' };
            return lastWorkResult;
          },
          buildDeterministicResult: (result) => ({
            id: result.id ?? purchaseId,
            status: 'Closed',
            ...(result.closed_at ? { closed_at: result.closed_at } : {}),
          }),
        });

        return { deterministicResult, workResult: lastWorkResult, didRunWork };
      });

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'closePurchaseOrder', { purchaseId }, auditPayload, true);
      return deterministicResult;
    } catch (e: any) {
      this.recordIdempotencyConflict(sessionId, e);
      await this.audit(sessionId, 'closePurchaseOrder', { purchaseId }, { error: e.message }, false);
      throw e;
    }
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
    const customerId = await this.resolveCustomerIdFromPayload(payload, sessionId);
    const baseQuoteDate = payload?.quote_date ? new Date(payload.quote_date) : new Date();
    const quoteDate = Number.isNaN(baseQuoteDate.getTime()) ? new Date() : baseQuoteDate;
    const validUntilCandidate = payload?.valid_until ? new Date(payload.valid_until) : null;
    const resolvedValidUntil = validUntilCandidate && !Number.isNaN(validUntilCandidate.getTime())
      ? validUntilCandidate
      : new Date(quoteDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const quoteInput = {
      ...payload,
      customer_id: customerId,
      quote_date: quoteDate,
      valid_until: resolvedValidUntil,
    };

    const idempotencyKey = extractIdempotencyKeyFromArgs(payload);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(
        this.pool,
        async (client) => {
          let lastWorkResult: any | null = null;
          let didRunWork = false;
          const deterministicResult = await idempotentWrite({
            db: this.pool,
            toolName: 'quote.create',
            idempotencyKey,
            requestPayload: quoteInput,
            work: async () => {
              didRunWork = true;
              const created = await this.quoteService.createQuote(quoteInput as any, client);
              lastWorkResult = created;
              return created;
            },
            buildDeterministicResult: (result) => ({
              id: result.quote_id,
              number: result.quote_number,
              status: 'Open',
              total: (result as any)?.total ?? null,
            }),
          });

          return { deterministicResult, workResult: lastWorkResult, didRunWork };
        }
      );

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'createQuote', payload, auditPayload, true);
      return deterministicResult;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
      await this.audit(sessionId, 'createQuote', payload, { error: error?.message }, false);
      throw error;
    }
  }
  async updateQuote(sessionId: number, quoteId: number, patch: any) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(patch);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(
        this.pool,
        async (client) => {
          let lastWorkResult: any | null = null;
          let didRunWork = false;
          const deterministicResult = await idempotentWrite({
            db: this.pool,
            toolName: 'quote.update',
            targetId: String(quoteId),
            idempotencyKey,
            requestPayload: patch,
            work: async () => {
              didRunWork = true;
              const allowed = [
                'customer_id',
                'quote_date',
                'valid_until',
                'product_name',
                'product_description',
                'estimated_cost',
                'status',
                'terms',
                'customer_po_number',
                'vin_number',
                'vehicle_make',
                'vehicle_model',
              ];
              const fields: string[] = [];
              const vals: any[] = [];
              let i = 1;
              for (const [k, v] of Object.entries(patch ?? {})) {
                if (allowed.includes(k) && v !== undefined && v !== null) {
                  fields.push(`${k}=$${i++}`);
                  vals.push(v);
                }
              }
              if (fields.length) {
                vals.push(quoteId);
                await client.query(
                  `UPDATE quotes SET ${fields.join(', ')}, updated_at = NOW() WHERE quote_id = $${i}`,
                  vals
                );
              }
              lastWorkResult = { updated: true };
              return { id: quoteId, updated: true };
            },
            buildDeterministicResult: (result) => ({
              id: result.id,
              updated: true,
            }),
          });

          return { deterministicResult, workResult: lastWorkResult, didRunWork };
        }
      );

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'updateQuote', { quoteId, patch }, auditPayload, true);
      return deterministicResult;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
      await this.audit(sessionId, 'updateQuote', { quoteId, patch }, { error: error?.message }, false);
      throw error;
    }
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

  async emailSearch(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
    if (!query) {
      throw new Error('query is required for email_search');
    }

    const maxRaw = payload?.max;
    const max = Number.isFinite(Number(maxRaw)) ? Math.max(1, Math.min(50, Number(maxRaw))) : undefined;

    try {
      const service = this.getAgentEmailService();
      const results = await service.emailSearch(resolvedUserId, query, max);
      const output = { provider: 'titan', results };
      await this.audit(sessionId, 'email_search', { query, max }, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'email_search',
        { query, max },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async emailRead(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const idSource = payload?.id ?? payload?.email_id ?? payload;
    const id = typeof idSource === 'string' ? idSource.trim() : String(idSource);
    if (!id || id === 'undefined' || id === 'null') {
      throw new Error('id is required for email_read');
    }

    try {
      const service = this.getAgentEmailService();
      const message = await service.emailRead(resolvedUserId, id);
      const output = { provider: 'titan', message };
      await this.audit(sessionId, 'email_read', { id }, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'email_read',
        { id },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async emailComposeDraft(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const to = this.normalizeRecipients(payload?.to);
    if (!to.length) {
      throw new Error('At least one recipient is required to compose a Titan email draft.');
    }
    const subject = typeof payload?.subject === 'string' ? payload.subject.trim() : '';
    if (!subject) {
      throw new Error('subject is required to compose a Titan email draft.');
    }

    const cc = this.normalizeRecipients(payload?.cc);
    const bcc = this.normalizeRecipients(payload?.bcc);
    const textBody = typeof payload?.text === 'string' ? payload.text : typeof payload?.textBody === 'string' ? payload.textBody : undefined;
    const htmlBody = typeof payload?.html === 'string' ? payload.html : typeof payload?.htmlBody === 'string' ? payload.htmlBody : undefined;

    const attachments: ComposeEmailAttachmentPayload[] | undefined = Array.isArray(payload?.attachments)
      ? payload.attachments
          .map((item: any): ComposeEmailAttachmentPayload | null => {
            const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
            const content = typeof item?.content === 'string' ? item.content : null;
            if (!filename || !content) {
              return null;
            }
            return {
              filename,
              content,
              encoding: typeof item?.encoding === 'string' ? (item.encoding as BufferEncoding) : undefined,
              contentType: typeof item?.contentType === 'string' ? item.contentType : undefined,
              cid: typeof item?.cid === 'string' ? item.cid : undefined,
              inline: this.toBoolean(item?.inline),
            };
          })
          .filter((item: ComposeEmailAttachmentPayload | null): item is ComposeEmailAttachmentPayload => Boolean(item))
      : undefined;

    const composePayload = {
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      textBody,
      htmlBody,
      attachments,
    };

    try {
      const service = this.getAgentEmailService();
      const result = await service.emailComposeDraft(resolvedUserId, composePayload);
      const output = { provider: 'titan', ...result };
      await this.audit(sessionId, 'email_compose_draft', composePayload, output, true);
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'email_compose_draft',
        composePayload,
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async emailSend(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const confirmTokenSource = payload?.confirm_token ?? payload?.confirmToken ?? payload?.token;
    const confirmToken = typeof confirmTokenSource === 'string' ? confirmTokenSource.trim() : '';
    if (!confirmToken) {
      throw new Error('confirm_token is required to send Titan email.');
    }

    const draftIdSource = payload?.draft_id ?? payload?.draftId ?? payload?.id;
    const draftId = typeof draftIdSource === 'string' ? draftIdSource.trim() : draftIdSource ? String(draftIdSource) : undefined;

    const directPayload = payload?.payload;
    const normalizedPayload = directPayload
      ? {
          to: this.normalizeRecipients(directPayload?.to),
          cc: this.normalizeRecipients(directPayload?.cc),
          bcc: this.normalizeRecipients(directPayload?.bcc),
          subject: typeof directPayload?.subject === 'string' ? directPayload.subject : '',
          textBody:
            typeof directPayload?.text === 'string'
              ? directPayload.text
              : typeof directPayload?.textBody === 'string'
                ? directPayload.textBody
                : undefined,
          htmlBody:
            typeof directPayload?.html === 'string'
              ? directPayload.html
              : typeof directPayload?.htmlBody === 'string'
                ? directPayload.htmlBody
                : undefined,
          attachments: Array.isArray(directPayload?.attachments) ? directPayload.attachments : undefined,
        }
      : undefined;

    try {
      const service = this.getAgentEmailService();
      const result = await service.emailSend(resolvedUserId, {
        draftId,
        payload: normalizedPayload,
        confirmToken,
      });
      const output = { provider: 'titan', result };
      await this.audit(
        sessionId,
        'email_send',
        { draftId, hasPayload: Boolean(normalizedPayload) },
        output,
        true
      );
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'email_send',
        { draftId, hasPayload: Boolean(normalizedPayload) },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
  }

  async emailReply(sessionId: number, userId: number | null | undefined, payload: any) {
    const resolvedUserId = this.requireEmailUser(userId);
    const messageId = typeof payload?.message_id === 'string' ? payload.message_id.trim() : payload?.messageId;
    const threadId = typeof payload?.thread_id === 'string' ? payload.thread_id.trim() : payload?.threadId;
    if (!messageId && !threadId) {
      throw new Error('message_id or thread_id is required for email_reply');
    }

    const replyAll = this.toBoolean(payload?.reply_all ?? payload?.replyAll);
    const bodyText = typeof payload?.body_text === 'string' ? payload.body_text : payload?.bodyText;
    const bodyHtml = typeof payload?.body_html === 'string' ? payload.body_html : payload?.bodyHtml;

    try {
      const service = this.getAgentEmailService();
      const result = await service.emailReply(resolvedUserId, {
        messageId: messageId ? String(messageId) : undefined,
        threadId: threadId ? String(threadId) : undefined,
        replyAll,
        bodyText: typeof bodyText === 'string' ? bodyText : undefined,
        bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : undefined,
        attachments: Array.isArray(payload?.attachments) ? payload.attachments : undefined,
      });
      const output = { provider: 'titan', result };
      await this.audit(
        sessionId,
        'email_reply',
        { messageId, threadId, replyAll },
        output,
        true
      );
      return output;
    } catch (error: any) {
      await this.audit(
        sessionId,
        'email_reply',
        { messageId, threadId, replyAll },
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

  async convertQuoteToSO(
    sessionId: number,
    quoteId: number,
    options?: { idempotency_key?: string; idempotencyKey?: string }
  ) {
    const idempotencyKey = extractIdempotencyKeyFromArgs(options);

    try {
      const { deterministicResult, workResult, didRunWork } = await withTransaction(
        this.pool,
        async (client) => {
          let lastWorkResult: any | null = null;
          let didRunWork = false;
          const deterministicResult = await idempotentWrite({
            db: this.pool,
            toolName: 'quote.convert_to_so',
            targetId: String(quoteId),
            idempotencyKey,
            requestPayload: { quoteId },
            work: async () => {
              didRunWork = true;
              const q = await client.query('SELECT * FROM quotes WHERE quote_id=$1', [quoteId]);
              if (q.rows.length === 0) {
                throw new Error('Quote not found');
              }
              const quote = q.rows[0];
              const estimatedCost = Number(quote.estimated_cost || 0);
              const salesOrder = await this.soService.createSalesOrder(
                {
                  header: {
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
                    total_gst_amount: estimatedCost * 0.05,
                    total_amount: estimatedCost * 1.05,
                    status: 'Open',
                    quote_id: quote.quote_id,
                    source_quote_number: quote.quote_number,
                  },
                  lineItems: [],
                },
                { access_role: 'Admin' },
                client
              );
              lastWorkResult = salesOrder;
              return { quote, salesOrder };
            },
            buildDeterministicResult: (result) => ({
              quote_id: result.quote.quote_id,
              sales_order_id: result.salesOrder.sales_order_id,
              sales_order_number: result.salesOrder.sales_order_number,
            }),
          });

          return { deterministicResult, workResult: lastWorkResult, didRunWork };
        }
      );

      this.recordIdempotencyResult(sessionId, didRunWork, deterministicResult);

      const auditPayload = workResult ?? deterministicResult;
      await this.audit(sessionId, 'convertQuoteToSO', { quoteId }, auditPayload, true);
      return deterministicResult;
    } catch (error: any) {
      this.recordIdempotencyConflict(sessionId, error);
      await this.audit(
        sessionId,
        'convertQuoteToSO',
        { quoteId },
        { error: error?.message ?? String(error) },
        false
      );
      throw error;
    }
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


