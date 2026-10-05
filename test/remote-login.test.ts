import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerLoginApi, type LoginConnection } from '../src/login-api.js';
import { LOGIN_CODE_PATH, LOGIN_STATE_PATH } from '../src/login-state.js';
import { KEY } from '../src/session.js';
import { body, cleanup, command, deferred, harness, liveSignal, server, temp } from './helpers.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function fixture(fetcher?: typeof fetch, timeoutMs?: number) {
  const dir = await temp(); cleanups.push(() => cleanup(dir));
  const codes = new Map<string, string>(); let exchanges = 0;
  const provider = await server((req, res) => { void body(req).then(bytes => {
    exchanges++;
    const payload = JSON.parse(bytes.toString()) as { code: string; code_verifier: string };
    const expected = codes.get(payload.code); codes.delete(payload.code);
    if (!expected || createHash('sha256').update(payload.code_verifier).digest('base64url') !== expected) { res.writeHead(400).end('SENSITIVE_PROVIDER_ERROR'); return; }
    res.end('{"token":"fixture-remote-token"}');
  }); }); cleanups.push(provider.close);
  const h = await harness(dir, { oauth: { apiBase: provider.base, fetcher, timeoutMs } }); cleanups.push(() => h.close());
  const routes = new Map<string, (request: Request) => Promise<Response>>();
  const connection: LoginConnection = {
    requestRejection: request => request.headers.get('cookie') === 'fixture-auth=yes' ? undefined : 401,
    fetch: { register: route => { routes.set(route.path, route.fetch); return async () => { routes.delete(route.path); }; } },
  };
  const dispose = registerLoginApi(connection, h.sessions); cleanups.push(dispose);
  const login = async () => {
    const result = await command(h, '/devin-login');
    expect(result?.result.kind).toBe('success');
    const text = result!.result.text!;
    const id = /Login attempt: ([A-Za-z0-9_-]+)/.exec(text)![1]!;
    const url = new URL(/Open this URL: (\S+)/.exec(text)![1]!);
    return { id, url };
  };
  const state = (id: string, authenticated = true) => routes.get(LOGIN_STATE_PATH)!(new Request(`http://dsh.internal${LOGIN_STATE_PATH}?attemptId=${id}`, { headers: authenticated ? { cookie: 'fixture-auth=yes' } : {} }));
  const submit = (id: string, code: unknown, authenticated = true) => routes.get(LOGIN_CODE_PATH)!(new Request(`http://dsh.internal${LOGIN_CODE_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { cookie: 'fixture-auth=yes' } : {}) }, body: JSON.stringify({ attemptId: id, code }) }));
  return { h, dir, codes, routes, login, state, submit, exchanges: () => exchanges };
}

describe('remote code login across the DSH authenticated seam', () => {
  it('returns immediately; code is accepted once, saved atomically and never recorded in chat or status', async () => {
    const f = await fixture(); const { id, url } = await f.login();
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect(f.h.sessions.available()).toBe(false);
    f.codes.set('fixture-private-code', url.searchParams.get('code_challenge')!);
    expect(await (await f.state(id)).json()).toMatchObject({ phase: 'pending', mode: 'code' });
    const response = await f.submit(id, 'fixture-private-code');
    expect(await response.json()).toMatchObject({ phase: 'authorized', attemptId: id });
    expect(f.h.sessions.available()).toBe(true);
    expect((await f.submit(id, 'fixture-private-code')).status).toBe(400);
    expect(f.exchanges()).toBe(1);
    const state = await f.state(id);
    expect(state.headers.get('cache-control')).toBe('no-store');
    const projection = await state.text();
    expect(projection).not.toContain('fixture-private-code'); expect(projection).not.toContain('fixture-remote-token');
    expect(JSON.stringify(f.h.events)).not.toContain('fixture-private-code');
    expect(JSON.stringify(f.h.events)).not.toContain('fixture-remote-token');
    const credentials = await readFile(join(f.dir, '.credentials.yaml'), 'utf8');
    expect(credentials).toContain('devin-search/session'); expect(credentials).not.toContain('fixture-private-code');
  });
  it('refuses unauthenticated status and submit before consuming a code; bad IDs and oversized input do not exchange', async () => {
    const f = await fixture(); const { id, url } = await f.login();
    f.codes.set('fixture-private-code', url.searchParams.get('code_challenge')!);
    expect((await f.state(id, false)).status).toBe(401);
    expect((await f.submit(id, 'fixture-private-code', false)).status).toBe(401);
    expect((await f.state('invalid')).status).toBe(400);
    expect((await f.state('A'.repeat(32))).status).toBe(404);
    expect((await f.submit('A'.repeat(32), 'fixture-private-code')).status).toBe(400);
    expect((await f.submit(id, 'S'.repeat(8193))).status).toBe(400);
    expect((await f.submit(id, 'S'.repeat(15000))).status).toBe(400);
    expect(f.exchanges()).toBe(0);
    expect((await f.submit(id, 'fixture-private-code')).status).toBe(200);
  });
  it('cancel retires the old ID and verifier; a code from the previous attempt cannot authorize the next', async () => {
    const f = await fixture(); const first = await f.login();
    f.codes.set('old-code', first.url.searchParams.get('code_challenge')!);
    expect((await command(f.h, '/devin-login'))?.result.text).toContain('already pending');
    await command(f.h, '/devin-cancel');
    await vi.waitFor(() => expect(f.h.ctx.authorization.describe(KEY)?.inFlight).toBe(false));
    expect((await f.submit(first.id, 'old-code')).status).toBe(400);
    const second = await f.login(); expect(second.id).not.toBe(first.id);
    expect((await f.state(first.id)).status).toBe(404);
    expect((await f.submit(first.id, 'old-code')).status).toBe(400);
    const bad = await f.submit(second.id, 'old-code');
    expect(await bad.json()).toMatchObject({ phase: 'error', detail: 'Devin token exchange failed. Please retry login.' });
    expect(f.h.sessions.available()).toBe(false);
    expect(await f.h.ctx.credentials.readRecord(KEY)).toBeUndefined();
  });
  it('logout during code exchange cannot resurrect a credential; disconnect can be reconciled through state', async () => {
    const received = deferred(); const release = deferred();
    const fetcher: typeof fetch = async () => { received.resolve(); await release.promise; return new Response('{"token":"fixture-late-token"}'); };
    const f = await fixture(fetcher); const first = await f.login();
    const submit = f.submit(first.id, 'fixture-code'); await received.promise;
    expect(await (await f.state(first.id)).json()).toMatchObject({ phase: 'exchanging' });
    await f.h.sessions.logout(); release.resolve();
    expect(await (await submit).json()).toMatchObject({ phase: 'cancelled' });
    expect(await f.h.ctx.credentials.readRecord(KEY)).toBeUndefined();
    expect(f.h.sessions.available()).toBe(false);
  });
  it('timeout leaves no grant, reports a terminal state and permits a fresh login', async () => {
    const f = await fixture(undefined, 25); const first = await f.login();
    await vi.waitFor(() => expect(f.h.ctx.authorization.describe(KEY)?.inFlight).toBe(false));
    expect((await f.submit(first.id, 'expired-code')).status).toBe(400);
    expect(f.h.sessions.loginState(first.id)?.phase).toBe('error');
    expect(f.exchanges()).toBe(0);
    const second = await f.login(); expect(second.id).not.toBe(first.id);
  });
  it('native authorization offers a secret prompt and shares persistence with slash login', async () => {
    const f = await fixture(); let authUrl!: URL;
    const flow = f.h.ctx.authorization.begin({ key: KEY, method: 'code', interaction: {
      notify: notice => { if (notice.url) authUrl = new URL(notice.url); },
      prompt: async prompt => {
        expect(prompt.kind).toBe('secret'); expect(prompt.signal).toBeInstanceOf(AbortSignal);
        f.codes.set('native-code', authUrl.searchParams.get('code_challenge')!); return 'native-code';
      },
    } });
    expect(await flow).toEqual({ status: 'authorized' });
    expect((await command(f.h, '/devin-login'))?.result.text).toContain('Already logged in');
    expect(JSON.stringify(f.h.events)).not.toContain('native-code');
  });
});
