import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindsurfCompletion } from '../src/completion.js';
import { JWT_PATH, STREAM_PATH, frame, gzipFrame } from '../src/protocol.js';
import { Writer, decode, stringField } from '../src/protobuf.js';
import { body, cleanup, deferred, harness, liveSignal, server, store, temp } from './helpers.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup() { const dir = await temp(); cleanups.push(() => cleanup(dir)); const h = await harness(dir); cleanups.push(() => h.close()); await store(h); return h; }
const textResponse = (text = '<ANSWER></ANSWER>') => new Response(new Uint8Array(Buffer.concat([gzipFrame(new Writer().string(2, text).build()), frame(Buffer.from('{}'), 2)])));
describe('private completion JWT and stream lifecycle', () => {
  it('caches by session token/account, rotation never uses the old JWT, logout invalidates access', async () => {
    const h = await setup(); const tokens: string[] = []; let jwtCalls = 0;
    const api = await server((req, res) => { void body(req).then(bytes => {
      if (req.url === JWT_PATH) {
        const token = stringField(decode(decode(bytes)[0]!.value as Buffer), 3)!; tokens.push(token); jwtCalls++; res.end(new Writer().string(1, `fixture-jwt-${token}`).build());
      } else if (req.url === STREAM_PATH) res.end(Buffer.concat([frame(new Writer().string(3, '<ANSWER></ANSWER>').build()), frame(Buffer.from('{}'), 2)]));
      else res.writeHead(404).end();
    }); }); cleanups.push(api.close);
    const cloud = new WindsurfCompletion(h.sessions, { base: api.base });
    await cloud.complete('system', [], '[]', liveSignal()); await cloud.complete('system', [], '[]', liveSignal()); expect(jwtCalls).toBe(1);
    await store(h, 'fixture-account-B'); await cloud.complete('system', [], '[]', liveSignal());
    expect(tokens).toEqual(['devin-session-token$fixture-session-A', 'devin-session-token$fixture-account-B']);
    await h.sessions.logout(); await expect(cloud.complete('sys', [], '[]', liveSignal())).rejects.toThrow('login'); expect(jwtCalls).toBe(2);
  });
  it('401/403 require login; ordinary network errors preserve credential and never echo response/cause', async () => {
    const h = await setup();
    const failure = new WindsurfCompletion(h.sessions, { fetcher: async () => new Response('fixture-session-A', { status: 500 }) });
    await expect(failure.complete('s', [], '[]', liveSignal())).rejects.toThrow('request failed'); expect(h.sessions.available()).toBe(true);
    const unauthorized = new WindsurfCompletion(h.sessions, { fetcher: async () => new Response('fixture-session-A', { status: 403 }) });
    await expect(unauthorized.complete('s', [], '[]', liveSignal())).rejects.toThrow('login'); expect(await h.sessions.status()).toContain('rejected');
  });
  it('revocation of an old in-flight account does not revoke the newly stored account', async () => {
    const h = await setup(); const old = (await h.sessions.access()).token;
    await store(h, 'fixture-account-new'); await h.sessions.revoke(old);
    expect(h.sessions.available()).toBe(true); expect((await h.sessions.access()).token).toBe('devin-session-token$fixture-account-new');
  });
  it('rotation cancels a pending JWT exchange, late JWT cannot poison next account cache', async () => {
    const h = await setup(); const entered = deferred(); const release = deferred<Response>(); let count = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith(JWT_PATH)) { if (++count === 1) { entered.resolve(); return release.promise; } return new Response(new Uint8Array(new Writer().string(1, 'fixture-new-jwt').build())); }
      return textResponse();
    });
    const cloud = new WindsurfCompletion(h.sessions, { fetcher });
    const active = cloud.complete('s', [], '[]', liveSignal()); const rejected = expect(active).rejects.toThrow('cancelled');
    await entered.promise; await store(h, 'fixture-account-B'); await rejected;
    release.resolve(new Response(new Uint8Array(new Writer().string(1, 'fixture-old-jwt').build())));
    expect(await cloud.complete('s', [], '[]', liveSignal())).toBe('<ANSWER></ANSWER>'); expect(count).toBe(2);
  });
  it('stream timeout/caller abort closes readers; secrets are removed from provider delta output', async () => {
    const h = await setup(); let cancelled = false;
    const fetcher: typeof fetch = async url => String(url).endsWith(JWT_PATH) ? new Response(new Uint8Array(new Writer().string(1, 'fixture-jwt').build())) : new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const cloud = new WindsurfCompletion(h.sessions, { fetcher, timeoutMs: 50 });
    await expect(cloud.complete('s', [], '[]', liveSignal())).rejects.toThrow('cancelled'); expect(cancelled).toBe(true);
    const echoed = new WindsurfCompletion(h.sessions, { fetcher: async url => String(url).endsWith(JWT_PATH) ? new Response(new Uint8Array(new Writer().string(1, 'fixture-jwt').build())) : textResponse('fixture-session-A fixture-jwt') });
    expect(await echoed.complete('s', [], '[]', liveSignal())).toBe('[redacted] [redacted]');
    const controller = new AbortController(); controller.abort(); const fetchSpy = vi.fn<typeof fetch>();
    await expect(new WindsurfCompletion(h.sessions, { fetcher: fetchSpy }).complete('s', [], '[]', controller.signal)).rejects.toThrow('cancelled'); expect(fetchSpy).not.toHaveBeenCalled();
  });
});
