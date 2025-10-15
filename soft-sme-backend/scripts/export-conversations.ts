#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { createHash } from 'crypto';

interface ConversationRow {
  conversation_id: string;
  company_id: number | null;
  user_id: number | null;
  message_role: string;
  message_content: any;
  message_created_at: string;
}

interface ExportRecord {
  conversationId: string;
  companyHash: string | null;
  userHash: string | null;
  role: string;
  content: any;
  createdAt: string;
}

const OUTPUT_DIR = path.resolve(__dirname, '..', 'analytics_exports');
const SAMPLE_CONVERSATIONS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'ai-assistant',
  'data',
  'sample_conversations.json'
);

const DAYS = Number(process.argv[2] ?? 30);
const SALT = process.env.CONVERSATION_EXPORT_SALT ?? 'soft-sme-analytics';

function hashValue(value: string | number | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const hash = createHash('sha256');
  hash.update(`${SALT}:${value}`);
  return hash.digest('hex').slice(0, 24);
}

async function fetchConversations(pool: Pool): Promise<ConversationRow[]> {
  const query = `
    SELECT
      m.conversation_id,
      c.company_id,
      c.user_id,
      m.role AS message_role,
      m.content AS message_content,
      m.created_at AS message_created_at
    FROM ai_messages m
    JOIN ai_conversations c ON c.id = m.conversation_id
    WHERE m.created_at >= NOW() - INTERVAL '${DAYS} days'
    ORDER BY m.conversation_id, m.created_at
  `;

  const result = await pool.query(query);
  return result.rows as ConversationRow[];
}

function loadSampleConversations(): ConversationRow[] {
  if (!fs.existsSync(SAMPLE_CONVERSATIONS_PATH)) {
    throw new Error('Sample conversation dataset missing.');
  }
  const raw = fs.readFileSync(SAMPLE_CONVERSATIONS_PATH, 'utf-8');
  return JSON.parse(raw) as ConversationRow[];
}

function sanitizeContent(content: any): any {
  if (!content) {
    return content;
  }

  if (typeof content === 'string') {
    return content;
  }

  if (typeof content === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
      if (value == null) {
        clone[key] = value;
        continue;
      }
      if (typeof value === 'string' && value.length > 1200) {
        clone[key] = `${value.slice(0, 1199)}…`;
      } else {
        clone[key] = value;
      }
    }
    return clone;
  }

  return content;
}

function transform(rows: ConversationRow[]): ExportRecord[] {
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    companyHash: hashValue(row.company_id),
    userHash: hashValue(row.user_id),
    role: row.message_role,
    content: sanitizeContent(row.message_content),
    createdAt: row.message_created_at,
  }));
}

function writeExport(records: ExportRecord[], source: 'database' | 'sample'): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `anonymized_conversations_${source}_${timestamp}.jsonl`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  const stream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  for (const record of records) {
    stream.write(`${JSON.stringify(record)}\n`);
  }
  stream.end();

  return outputPath;
}

async function main() {
  let pool: Pool | null = null;
  let rows: ConversationRow[] = [];
  let source: 'database' | 'sample' = 'database';

  try {
    pool = new Pool();
    rows = await fetchConversations(pool);
  } catch (error) {
    console.warn('Falling back to sample conversations dataset:', (error as Error).message);
    rows = loadSampleConversations();
    source = 'sample';
  } finally {
    await pool?.end();
  }

  const records = transform(rows);
  const outputPath = writeExport(records, source);

  console.log(`Exported ${records.length} messages to ${outputPath}`);
}

main().catch((error) => {
  console.error('Failed to export conversations', error);
  process.exit(1);
});

