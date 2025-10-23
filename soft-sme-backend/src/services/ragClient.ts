import { spawn } from 'child_process';
import path from 'path';

export interface RagChunk {
  title: string;
  path: string;
  text: string;
  score: number;
}

export interface RagCitation {
  title: string;
  path: string;
  score: number;
}

export interface RagResponse {
  answer: string | null;
  chunks: RagChunk[];
  citations: RagCitation[];
}

const DEFAULT_RESULT: RagResponse = { answer: null, chunks: [], citations: [] };
const DEFAULT_TIMEOUT_MS = 3500;

function getTimeout(): number {
  const envTimeout = process.env.DOCS_RAG_TIMEOUT_MS;
  if (!envTimeout) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = parseInt(envTimeout, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getTopK(topK?: number): number {
  return typeof topK === 'number' && Number.isFinite(topK) ? topK : 5;
}

async function queryViaHttp(query: string, topK: number, timeoutMs: number): Promise<RagResponse> {
  const url = process.env.DOCS_RAG_HTTP_URL;
  if (!url) {
    return DEFAULT_RESULT;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, top_k: topK }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return DEFAULT_RESULT;
    }

    const data = await response.json();
    return {
      answer: typeof data.answer === 'string' ? data.answer : null,
      chunks: Array.isArray(data.chunks) ? data.chunks : [],
      citations: Array.isArray(data.citations) ? data.citations : [],
    };
  } catch (error) {
    return DEFAULT_RESULT;
  } finally {
    clearTimeout(timeout);
  }
}

async function queryViaCli(query: string, topK: number, timeoutMs: number): Promise<RagResponse> {
  return new Promise<RagResponse>((resolve) => {
    const cliScript = path.resolve(__dirname, '..', '..', 'ai_agent', 'rag_cli.py');
    const subprocess = spawn('python3', [
      cliScript,
      '--query',
      query,
      '--top_k',
      String(topK),
    ]);

    let stdout = '';
    let finished = false;

    const complete = (result: RagResponse) => {
      if (!finished) {
        finished = true;
        clearTimeout(timeoutHandle);
        resolve(result);
      }
    };

    const timeoutHandle = setTimeout(() => {
      subprocess.kill();
      complete(DEFAULT_RESULT);
    }, timeoutMs);

    subprocess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    subprocess.stderr.on('data', () => {
      // Ignore stderr output but ensure the stream is consumed
    });

    subprocess.on('error', () => {
      complete(DEFAULT_RESULT);
    });

    subprocess.on('close', (code) => {
      if (finished) {
        return;
      }

      if (code !== 0 || !stdout) {
        complete(DEFAULT_RESULT);
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        const result: RagResponse = {
          answer: typeof parsed.answer === 'string' ? parsed.answer : null,
          chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
          citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        };
        complete(result);
      } catch (error) {
        complete(DEFAULT_RESULT);
      }
    });
  });
}

export async function queryDocsRag(query: string, topK?: number): Promise<RagResponse> {
  const timeoutMs = getTimeout();
  const resolvedTopK = getTopK(topK);

  if (process.env.DOCS_RAG_HTTP_URL) {
    return queryViaHttp(query, resolvedTopK, timeoutMs);
  }

  try {
    return await queryViaCli(query, resolvedTopK, timeoutMs);
  } catch (error) {
    return DEFAULT_RESULT;
  }
}
