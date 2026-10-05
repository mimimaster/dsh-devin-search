import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { oauthCode } from '../src/oauth.js';
import { body, deferred, liveSignal, server } from './helpers.js';

describe('official no-redirect PKCE code flow', () => {
  it('omits redirect_uri, starts no listener, uses the initiating verifier and cancels the prompt with its lifetime', async () => {
    let exchanged: { code: string; code_verifier: string } | undefined;
    const api = await server((req, res) => { void body(req).then(bytes => { exchanged = JSON.parse(bytes.toString()); res.end('{"token":"fixture-code-token"}'); }); });
    const occupied = await server((_req, res) => res.end());
    try {
      const notice = deferred<string>(); const code = deferred<string>(); let promptSignal!: AbortSignal;
      const result = oauthCode(liveSignal(), notice.resolve, signal => { promptSignal = signal; return code.promise; }, { port: occupied.port, apiBase: api.base });
      const url = new URL(await notice.promise);
      expect(url.searchParams.has('redirect_uri')).toBe(false);
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      code.resolve('  fixture-once-code  ');
      expect(await result).toBe('fixture-code-token');
      expect(exchanged?.code).toBe('fixture-once-code');
      expect(createHash('sha256').update(exchanged!.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
      expect(promptSignal).toBeInstanceOf(AbortSignal);
    } finally { await occupied.close(); await api.close(); }
  });
  it('rejects invalid input without contacting the provider or reflecting the code', async () => {
    const fetcher = vi.fn();
    for (const code of ['', 'secret\nvalue', 'S'.repeat(8193)]) {
      await expect(oauthCode(liveSignal(), () => {}, async () => code, { fetcher })).rejects.toThrow('Invalid Devin authorization code.');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preabort, timeout and cancel stop a pending secret prompt without exchange', async () => {
    const before = new AbortController(); before.abort(); const notify = vi.fn(); const fetcher = vi.fn();
    await expect(oauthCode(before.signal, notify, async () => 'unused', { fetcher })).rejects.toThrow('cancelled');
    expect(notify).not.toHaveBeenCalled();
    const code = deferred<string>(); let signal!: AbortSignal;
    const timeout = oauthCode(liveSignal(), () => {}, life => { signal = life; return code.promise; }, { timeoutMs: 20, fetcher });
    await expect(timeout).rejects.toThrow('cancelled'); expect(signal.aborted).toBe(true);
    code.resolve('expired-code'); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('redacts provider error bodies and creates distinct state/challenge on retry', async () => {
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      await expect(oauthCode(liveSignal(), url => urls.push(url), async () => 'secret-code', { fetcher: async () => new Response('secret-code AND provider-secret', { status: 400 }) })).rejects.toThrow(/^Devin token exchange failed/);
    }
    expect(new URL(urls[0]!).searchParams.get('code_challenge')).not.toBe(new URL(urls[1]!).searchParams.get('code_challenge'));
    expect(new URL(urls[0]!).searchParams.get('state')).not.toBe(new URL(urls[1]!).searchParams.get('state'));
  });
});
