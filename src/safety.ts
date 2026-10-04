export class DevinError extends Error {
  constructor(readonly code: 'cancelled' | 'login' | 'network' | 'protocol' | 'bounds' | 'path' | 'busy' | 'storage', message: string) {
    super(message); this.name = 'DevinError';
  }
}
export const fail = (code: DevinError['code'], message: string): never => { throw new DevinError(code, message); };
export function check(signal: AbortSignal): void {
  if (signal.aborted) fail('cancelled', 'Devin operation cancelled or timed out.');
}
export function safeError(error: unknown): string {
  return error instanceof DevinError ? error.message : 'Devin operation failed. No provider details were retained.';
}
export function deadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(ms)]);
}
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); check(signal); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DevinError('cancelled', 'Devin operation cancelled or timed out.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}
export async function boundedBody(response: Response, signal: AbortSignal, cap = 2 * 1024 * 1024): Promise<Buffer> {
  if (signal.aborted) { await response.body?.cancel().catch(() => {}); check(signal); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      check(signal);
      const { done, value } = await abortable(reader.read(), signal);
      check(signal); if (done) break;
      bytes += value.length;
      if (bytes > cap) fail('bounds', 'Devin response exceeded the byte budget.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
export async function request(url: string, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  check(signal);
  try {
    const pending = fetcher(url, { ...init, signal, redirect: 'error' }).then(async response => {
      if (signal.aborted) { await response.body?.cancel().catch(() => {}); check(signal); }
      return response;
    });
    return await abortable(pending, signal);
  }
  catch { check(signal); return fail('network', 'Devin network request failed.'); }
}
/** Windsurf/Codeium metadata.apiKey form. OAuth /auth/cli/token returns bare JWT. */
export const DEVIN_SESSION_TOKEN_PREFIX = 'devin-session-token$'

/** Idempotent: bare JWT → `devin-session-token$…`; already-prefixed / sk-ws-* left as-is. */
export function toDevinSessionToken(token: string): string {
  const raw = token.trim()
  if (!raw) return raw
  if (raw.startsWith(DEVIN_SESSION_TOKEN_PREFIX) || raw.startsWith('sk-ws-')) return raw
  return `${DEVIN_SESSION_TOKEN_PREFIX}${raw}`
}

export function expiry(token: string, now = Date.now()): { expiresAt: number; expirySource: 'jwt' | 'fallback' } {
  try {
    // Accept bare JWT or `devin-session-token$<jwt>` — payload is still segment [1].
    const body = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    if (typeof body.exp === 'number' && Number.isFinite(body.exp) && body.exp > 0) {
      return { expiresAt: body.exp * 1000 - 60_000, expirySource: 'jwt' };
    }
  } catch { /* Opaque sessions are not refresh grants. */ }
  return { expiresAt: now + 24 * 60 * 60 * 1000, expirySource: 'fallback' };
}
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function json(buffer: Buffer): unknown {
  try { return JSON.parse(buffer.toString('utf8')); } catch { return fail('protocol', 'Invalid Devin JSON response.'); }
}
/** Expand a session token into all wire forms that must stay out of model text. */
export function sessionSecrets(token: string): string[] {
  const out = new Set<string>()
  const raw = token.trim()
  if (!raw) return []
  out.add(raw)
  out.add(toDevinSessionToken(raw))
  if (raw.startsWith(DEVIN_SESSION_TOKEN_PREFIX)) out.add(raw.slice(DEVIN_SESSION_TOKEN_PREFIX.length))
  return [...out].filter(Boolean)
}

export function redact(text: string, secrets: readonly string[]): string {
  const all = new Set<string>()
  for (const secret of secrets) for (const part of sessionSecrets(secret)) all.add(part)
  // Longest first so prefixed forms redact before bare JWT tails.
  for (const secret of [...all].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.split(secret).join('[redacted]')
  }
  return text
}
