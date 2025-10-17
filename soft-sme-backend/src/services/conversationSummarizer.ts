import { Pool } from 'pg';
import { pool as defaultPool } from '../db';
import {
  ConversationManager,
  ConversationMessage,
  ConversationSummarySnapshot,
  ConversationSummaryUpdate
} from './aiConversationManager';

export interface ConversationSummaryOptions {
  force?: boolean;
  maxMessages?: number;
}

export interface ConversationSummaryResult extends ConversationSummarySnapshot {
  lastSummarizedMessageId: string | null;
}

const DEFAULT_MAX_MESSAGES = 200;
const HIGHLIGHT_LIMIT = 3;
const HIGHLIGHT_CHAR_LIMIT = 220;

const sanitizeText = (input: string): string => {
  return input.replace(/\s+/g, ' ').trim();
};

const truncate = (input: string, limit: number): string => {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit - 1)}…`;
};

const extractHighlights = (messages: ConversationMessage[]): string[] => {
  const recent = messages.filter(msg => msg.role === 'user').slice(-HIGHLIGHT_LIMIT * 2);
  const highlights = recent
    .map(msg => truncate(sanitizeText(msg.content), HIGHLIGHT_CHAR_LIMIT))
    .filter(text => text.length > 0);

  return highlights.slice(-HIGHLIGHT_LIMIT);
};

const extractResolution = (messages: ConversationMessage[]): string | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant') {
      const cleaned = sanitizeText(message.content);
      if (cleaned.length > 0) {
        return truncate(cleaned, HIGHLIGHT_CHAR_LIMIT);
      }
    }
  }
  return null;
};

const composeSummary = (highlights: string[], resolution: string | null): string => {
  const sections: string[] = [];

  if (highlights.length > 0) {
    sections.push(`Key points: ${highlights.join('; ')}`);
  }

  sections.push(
    resolution
      ? `Latest resolution: ${resolution}`
      : 'Latest resolution: Pending — no assistant action recorded yet.'
  );

  return sections.join(' ');
};

export class ConversationSummarizer {
  private readonly manager: ConversationManager;

  constructor(private readonly db: Pool = defaultPool) {
    this.manager = new ConversationManager(db);
  }

  async summarizeConversation(
    conversationId: string,
    options: ConversationSummaryOptions = {}
  ): Promise<ConversationSummaryResult | null> {
    const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    const conversation = await this.manager.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const history = await this.manager.getConversationHistory(conversationId, maxMessages);

    if (history.length === 0) {
      await this.manager.updateConversationSummary(conversationId, {
        summaryText: null,
        highlights: [],
        resolution: null,
        lastSummarizedMessageId: null
      });
      return null;
    }

    const lastMessageId = history[history.length - 1]?.id ?? null;

    if (!options.force && conversation.summary.metadata.lastSummarizedMessageId === lastMessageId) {
      return {
        ...conversation.summary,
        lastSummarizedMessageId: conversation.summary.metadata.lastSummarizedMessageId
      };
    }

    const highlights = extractHighlights(history);
    const resolution = extractResolution(history);
    const summaryText = composeSummary(highlights, resolution);

    const payload: ConversationSummaryUpdate = {
      summaryText,
      highlights,
      resolution,
      lastSummarizedMessageId: lastMessageId
    };

    await this.manager.updateConversationSummary(conversationId, payload);

    return {
      summaryText,
      metadata: {
        highlights,
        resolution,
        lastSummarizedMessageId: lastMessageId
      },
      updatedAt: new Date(),
      lastSummarizedMessageId: lastMessageId
    };
  }

  static summarizeMessages(messages: ConversationMessage[]): {
    summaryText: string;
    highlights: string[];
    resolution: string | null;
  } {
    const highlights = extractHighlights(messages);
    const resolution = extractResolution(messages);
    const summaryText = composeSummary(highlights, resolution);

    return { summaryText, highlights, resolution };
  }
}

export default ConversationSummarizer;
