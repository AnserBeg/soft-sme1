import express, { Request, Response } from 'express';

// Node 20+ has global fetch; fallback import only if needed
const _fetch: typeof fetch = (global as any).fetch ?? require('node-fetch');

const router = express.Router();

type AssistantEndpoints = {
  baseUrl: string;
  chatUrl: string;
  healthUrl: string;
};

const CHAT_SUFFIXES = ['/assistant', '/chat', '/chat/completions'];
const HEALTH_SUFFIXES = ['/healthz', '/health', '/status'];

function parseDisabledFlag(raw?: string | null): boolean {
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return ['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized);
}

function assistantDisabledState(): { disabled: boolean; reason?: string } {
  if (parseDisabledFlag(process.env.ENABLE_AI_AGENT)) {
    return { disabled: true, reason: 'Assistant disabled via ENABLE_AI_AGENT flag' };
  }

  if (parseDisabledFlag(process.env.ASSISTANT_DISABLED)) {
    return { disabled: true, reason: 'Assistant disabled via ASSISTANT_DISABLED flag' };
  }

  return { disabled: false };
}

function parseAbsoluteUrl(raw?: string | null): URL | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed);
  } catch (error) {
    if (!/^https?:\/\//i.test(trimmed)) {
      try {
        return new URL(`http://${trimmed}`);
      } catch (innerError) {
        return undefined;
      }
    }
    return undefined;
  }
}

function stripPathSuffix(url: URL, suffixes: string[]): URL {
  const clone = new URL(url.toString());
  let pathname = clone.pathname.replace(/\/+$/, '') || '/';
  const lowerPath = pathname.toLowerCase();

  for (const suffix of suffixes) {
    const normalizedSuffix = suffix.replace(/\/+$/, '');
    if (!normalizedSuffix) {
      continue;
    }

    if (lowerPath.endsWith(normalizedSuffix.toLowerCase())) {
      const newLength = pathname.length - normalizedSuffix.length;
      pathname = newLength > 0 ? pathname.slice(0, newLength) : '/';
      break;
    }
  }

  clone.pathname = pathname;
  clone.search = '';
  clone.hash = '';
  return clone;
}

function ensurePathEndsWithSlash(url: URL): string {
  const clone = new URL(url.toString());
  if (!clone.pathname.endsWith('/')) {
    clone.pathname += '/';
  }
  return clone.toString();
}

function joinRelativePath(base: URL, relativePath: string): string {
  const sanitizedRelative = relativePath.replace(/^\/+/, '');
  return new URL(sanitizedRelative, ensurePathEndsWithSlash(base)).toString().replace(/\/+$/, '');
}

function resolveAssistantEndpoints(): AssistantEndpoints {
  const explicitCandidates = [
    process.env.ASSISTANT_API_URL,
    process.env.AI_AGENT_CHAT_URL,
    process.env.AI_AGENT_REMOTE_URL,
    process.env.AI_AGENT_ENDPOINT,
  ];

  const healthCandidate = process.env.AI_AGENT_HEALTH_URL || process.env.ASSISTANT_HEALTH_URL;

  let baseUrl: URL | undefined;
  let chatUrl: string | undefined;
  let healthUrl: string | undefined;

  if (healthCandidate) {
    const parsed = parseAbsoluteUrl(healthCandidate);
    if (parsed) {
      healthUrl = parsed.toString().replace(/\/+$/, '');
      baseUrl = stripPathSuffix(parsed, HEALTH_SUFFIXES);
    }
  }

  for (const candidate of explicitCandidates) {
    if (!candidate) {
      continue;
    }

    const parsed = parseAbsoluteUrl(candidate);
    if (!parsed) {
      continue;
    }

    const sanitized = new URL(parsed.toString());
    sanitized.search = '';
    sanitized.hash = '';

    const trimmedPath = sanitized.pathname.replace(/\/+$/, '');
    const lowerPath = trimmedPath.toLowerCase();
    let matchedSuffix = false;

    for (const suffix of CHAT_SUFFIXES) {
      const normalizedSuffix = suffix.replace(/\/+$/, '');
      if (!normalizedSuffix) {
        continue;
      }

      if (lowerPath.endsWith(normalizedSuffix.toLowerCase())) {
        chatUrl = sanitized.toString().replace(/\/+$/, '');
        baseUrl = stripPathSuffix(sanitized, CHAT_SUFFIXES);
        matchedSuffix = true;
        break;
      }
    }

    if (!matchedSuffix) {
      baseUrl = sanitized;
      chatUrl = joinRelativePath(sanitized, 'assistant');
    }

    if (!healthUrl && baseUrl) {
      healthUrl = joinRelativePath(baseUrl, 'healthz');
    }

    break;
  }

  if (!baseUrl) {
    const host = process.env.AI_AGENT_HOST || '127.0.0.1';
    const port =
      process.env.AI_AGENT_PORT || process.env.ASSISTANT_PORT || process.env.AI_AGENT_HTTP_PORT || '5001';
    const protocol = process.env.AI_AGENT_PROTOCOL || 'http';
    baseUrl = parseAbsoluteUrl(`${protocol}://${host}:${port}`) ?? new URL('http://127.0.0.1:5001');
  }

  if (!chatUrl) {
    chatUrl = joinRelativePath(baseUrl, 'assistant');
  }

  if (!healthUrl) {
    // Prefer /healthz but fall back to /health if needed
    healthUrl = joinRelativePath(baseUrl, 'healthz');
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/+$/, ''),
    chatUrl,
    healthUrl,
  };
}

const assistantEndpoints = resolveAssistantEndpoints();

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const rawToken = process.env.AI_AGENT_SERVICE_TOKEN?.trim();
  if (rawToken) {
    headers.Authorization = rawToken.toLowerCase().startsWith('bearer ')
      ? rawToken
      : `Bearer ${rawToken}`;
  }

  const apiKey = process.env.AI_AGENT_SERVICE_API_KEY?.trim();
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const defaultCompanyId = process.env.AGENT_V2_DEFAULT_COMPANY_ID?.trim();
  if (defaultCompanyId) {
    headers['x-company-id'] = defaultCompanyId;
  }

  const defaultUserId = process.env.AGENT_V2_DEFAULT_USER_ID?.trim();
  if (defaultUserId) {
    headers['x-user-id'] = defaultUserId;
  }

  const defaultEmail = process.env.AGENT_V2_DEFAULT_USER_EMAIL?.trim();
  if (defaultEmail) {
    headers['x-user-email'] = defaultEmail;
  }

  return headers;
}

const assistantHeaders = buildAuthHeaders();

function mapAssistantError(err: unknown) {
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as any)?.cause;
    if (cause && typeof cause === 'object') {
      const code = (cause as any)?.code;
      const address = (cause as any)?.address;
      const port = (cause as any)?.port;
      const causeParts: string[] = [];
      if (code) {
        causeParts.push(String(code));
      }
      if (address) {
        causeParts.push(String(address));
      }
      if (port) {
        causeParts.push(`port ${port}`);
      }
      if (causeParts.length) {
        parts.push(`(${causeParts.join(' ')})`);
      }
    }
    return parts.join(' ');
  }
  return String(err);
}

function isConnectionRefused(err: unknown): boolean {
  const cause = (err as any)?.cause;
  const code = (cause as any)?.code || (err as any)?.code;
  if (typeof code === 'string' && code.toUpperCase() === 'ECONNREFUSED') {
    return true;
  }
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('econnrefused') || message.includes('connection refused');
}

router.get('/health', async (_req: Request, res: Response) => {
  const disabled = assistantDisabledState();
  if (disabled.disabled) {
    return res.status(503).json({
      status: 'disabled',
      reason: disabled.reason,
      endpoint: assistantEndpoints.healthUrl,
    });
  }

  try {
    const r = await _fetch(assistantEndpoints.healthUrl, {
      headers: assistantHeaders,
    });
    const j = await r.json();
    res.json(j);
  } catch (err) {
    res
      .status(500)
      .json({ status: 'error', error: mapAssistantError(err), endpoint: assistantEndpoints.healthUrl });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const disabled = assistantDisabledState();
  if (disabled.disabled) {
    return res.status(503).json({
      message: 'Assistant service is disabled',
      reason: disabled.reason,
    });
  }

  try {
    const { prompt, mode } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'prompt is required' });
    }

    const r = await _fetch(assistantEndpoints.chatUrl, {
      method: 'POST',
      headers: assistantHeaders,
      body: JSON.stringify({ prompt, mode })
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ message: 'Assistant service error', detail: txt });
    }

    const j = await r.json();
    res.json(j);
  } catch (err) {
    const unreachable = isConnectionRefused(err);
    res.status(unreachable ? 503 : 500).json({
      message: unreachable ? 'Assistant service is unreachable' : 'Failed to call assistant',
      error: mapAssistantError(err),
      endpoint: assistantEndpoints.chatUrl,
      hint: unreachable
        ? 'Verify the AI agent service is running or configure ENABLE_AI_AGENT=1 / AI_AGENT_REMOTE_URL.'
        : undefined,
    });
  }
});

export default router;

