import fs from 'fs';
import path from 'path';
import { pool } from '../src/db';

function chunkText(text: string, chunkSize = 1200, overlap = 200): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

async function main() {
  const docPath = path.resolve(__dirname, '../../soft-sme-frontend/src/docs/architecture-and-pages.md');
  const content = fs.readFileSync(docPath, 'utf-8');
  const sections = content.split('\n## '); // rough split by major headings
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const section of sections) {
      const header = section.split('\n')[0];
      const text = section.substring(header.length).trim();
      const chunks = chunkText(text);
      for (const c of chunks) {
        await client.query(
          'INSERT INTO agent_docs (path, section, chunk) VALUES ($1, $2, $3)',
          [docPath, header || 'ROOT', c]
        );
      }
    }
    await client.query('COMMIT');
    console.log('Ingested docs into agent_docs table');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to ingest docs:', err);
  } finally {
    client.release();
  }
}

main();


