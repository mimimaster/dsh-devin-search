import { afterEach, describe, expect, it, vi } from 'vitest';
import { webProvider } from '../src/web.js';
import { harness, store, temp, cleanup, liveSignal, server, deferred } from './helpers.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup() { const dir = await temp(); cleanups.push(() => cleanup(dir)); const h = await harness(dir); cleanups.push(() => h.close()); await store(h); return h; }
describe('native Devin web provider', () => {
  it('cheap availability, two-host fallback, aliases, URL validation, caps and secret redaction', async () => {
    const h = await setup(); let calls = 0;
    const broken = await server((_req, res) => { calls++; res.writeHead(500).end('fixture-session-A'); }); cleanups.push(broken.close);
    const working = await server((_req, res) => { calls++; res.end(JSON.stringify({ results: [{ url: 'javascript:bad' }, { link: 'https://example.test/a', name: 'a', summary: 'fixture-session-A' }, { sourceUrl: 'http://example.test/b', webTitle: 'b' }, { url: 'https://example.test/c' }] })); }); cleanups.push(working.close);
    const provider = webProvider(h.sessions, { hosts: [broken.base, working.base] });
    expect(provider.available()).toBe(true); expect(calls).toBe(0);
    const result = await provider.search({ query: 'fixture', maxResults: 2 }); expect(calls).toBe(2); expect(result.sources).toHaveLength(2); expect(result.truncated).toBe(true); expect(result.sources[0]?.snippet).toBe('[redacted]');
  });
  it('abort does not continue fallback, preabort does not call fetch', async () => {
    const h = await setup(); const fetcher = vi.fn<typeof fetch>(); const controller = new AbortController();
    fetcher.mockImplementation(async (_url, init) => { controller.abort(); throw new Error(`secret ${init?.body}`); });
    const provider = webProvider(h.sessions, { fetcher });
    await expect(provider.search({ query: 'fixture' }, controller.signal)).rejects.toThrow('cancelled'); expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(provider.search({ query: 'fixture' }, controller.signal)).rejects.toThrow('cancelled'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds/schema fail closed; provider/network errors never expose keys', async () => {
    const h = await setup();
    const malformed = webProvider(h.sessions, { fetcher: async () => new Response('{"error":"fixture-session-A"}') });
    await expect(malformed.search({ query: 'x' })).rejects.toThrow('schema');
    const large = webProvider(h.sessions, { fetcher: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
    await expect(large.search({ query: 'x' })).rejects.toThrow('budget');
    const throwing = webProvider(h.sessions, { fetcher: async () => { throw new Error('fixture-session-A'); } });
    await expect(throwing.search({ query: 'x' })).rejects.toThrow('all hosts');
    expect(h.sessions.available()).toBe(true);
  });
  it('401 marks only the rejected session; expiry disables search without network', async () => {
    const h = await setup();
    await expect(webProvider(h.sessions, { fetcher: async () => new Response('SECRET', { status: 401 }) }).search({ query: 'x' })).rejects.toThrow('login');
    expect(h.sessions.available()).toBe(false); expect(await h.sessions.status()).toContain('rejected');
    await store(h, 'fixture-new', Date.now() - 1); const fetcher = vi.fn<typeof fetch>();
    expect(webProvider(h.sessions, { fetcher }).available()).toBe(false);
    await expect(webProvider(h.sessions, { fetcher }).search({ query: 'x' })).rejects.toThrow('expired'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('logout aborts the response reader and no host fallback; timeout aborts a hung reader', async () => {
    const h = await setup(); const entered = deferred(); let cancelled = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { entered.resolve(); return new Response(new ReadableStream({ cancel() { cancelled = true; } })); });
    const active = webProvider(h.sessions, { fetcher }).search({ query: 'x' }); const rejected = expect(active).rejects.toThrow('cancelled');
    await entered.promise; await h.sessions.logout(); await rejected; expect(cancelled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    await store(h); cancelled = false;
    await expect(webProvider(h.sessions, { fetcher, timeoutMs: 50 }).search({ query: 'x' })).rejects.toThrow('cancelled'); expect(cancelled).toBe(true);
  });
});
