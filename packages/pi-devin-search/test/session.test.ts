import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevinError } from '../../../src/safety.js';
import { AuthStore, type Grant } from '../src/store.js';
import { AuthSession, formatExpiry, type LoginInteraction } from '../src/session.js';
import { EXPIRY_TIME_MAX } from '../src/store.js';
import { body, cleanup, deferred, jwt, liveSignal, server, tempDir } from './helpers.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()));
  await Promise.all(dirs.splice(0).map(cleanup));
});

async function fixture(options: ConstructorParameters<typeof AuthSession>[1] = {}) {
  const dir = await tempDir();
  dirs.push(dir);
  const store = new AuthStore(dir);
  const invalidated: number[] = [];
  const session = new AuthSession(store, { ...options, onInvalidate: () => { invalidated.push(1); options.onInvalidate?.(); } });
  return { dir, store, session, invalidated };
}

function interaction(prompt: LoginInteraction['prompt'], notify: LoginInteraction['notify'] = vi.fn()): LoginInteraction {
  return { hasUI: true, notify, prompt };
}

describe('pi devin auth session', () => {
  it('rejects non-interactive login before any URL, prompt, or network', async () => {
    const { session } = await fixture();
    const notify = vi.fn(); const prompt = vi.fn(); const fetcher = vi.fn();
    const quiet = new AuthSession(new AuthStore((await fixture()).dir), { fetcher });
    await expect(session.login({ hasUI: false, notify, prompt })).rejects.toThrow('Devin login requires an interactive UI.');
    await expect(quiet.login({ hasUI: false, notify, prompt })).rejects.toThrow('interactive UI');
    expect(notify).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('defaults to PKCE code login, normalizes expiry, and returns only safe status', async () => {
    const secretCode = 'fixture-once-code-SECRET';
    const raw = jwt(2_000_000_000);
    let exchanged: { code?: string } | undefined;
    const api = await server((req, res) => { void body(req).then(bytes => { exchanged = JSON.parse(bytes.toString()); res.end(JSON.stringify({ token: raw })); }); });
    closers.push(api.close);
    const { session, store, invalidated } = await fixture({ apiBase: api.base, port: 1 });
    const notice = deferred<string>();
    let promptSignal: AbortSignal | undefined;
    const saved = await session.login(interaction(signal => { promptSignal = signal; return Promise.resolve(`  ${secretCode}  `); }, url => notice.resolve(url)));
    const url = new URL(await notice.promise);
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(promptSignal).toBeInstanceOf(AbortSignal);
    expect(saved).toBe('Login saved.');
    expect(saved).not.toContain(secretCode);
    expect(saved).not.toContain('http');
    expect(exchanged?.code).toBe(secretCode);
    const record = await store.read();
    expect(record?.token).toBe(`devin-session-token$${raw}`);
    expect(record?.expirySource).toBe('jwt');
    expect(record?.expiresAt).toBe(2_000_000_000_000 - 60_000);
    const status = await session.status();
    expect(status).toContain('Logged in');
    expect(status).toContain('no automatic refresh');
    expect(status).not.toMatch(/refresh available/i);
    expect(status).not.toContain(secretCode);
    expect(status).not.toContain(raw);
    expect(status).not.toContain('http');
    expect(session.available()).toBe(true);
    expect(invalidated.length).toBeGreaterThan(0);
    const access = await session.access(liveSignal());
    expect(access.token).toBe(record?.token);
    expect(access.signal.aborted).toBe(false);
  });

  it('keeps a single login owner and allows a later login after cancel', async () => {
    const { session } = await fixture({ fetcher: vi.fn() });
    const gate = deferred<string>();
    let prompts = 0;
    const first = session.login(interaction(async () => { prompts++; return gate.promise; }));
    await vi.waitFor(() => expect(prompts).toBe(1));
    const extra = vi.fn();
    await expect(session.login(interaction(async () => 'other-code', extra))).resolves.toBe('Login already pending.');
    expect(extra).not.toHaveBeenCalled();
    session.cancel();
    await expect(first).rejects.toThrow('cancelled');
    expect(prompts).toBe(1);
    const api = await server((_req, res) => res.end('{"token":"opaque-fixture"}'));
    closers.push(api.close);
    const { session: next, store } = await fixture({ apiBase: api.base });
    await next.login(interaction(async () => 'fixture-code'));
    expect((await store.read())?.token).toBe('devin-session-token$opaque-fixture');
    expect((await store.read())?.expirySource).toBe('fallback');
    expect(await next.status()).toContain('no automatic refresh');
  });

  it('cancels, times out, and disposes without committing or leaking the code', async () => {
    const fetcher = vi.fn();
    const { session, store } = await fixture({ fetcher, timeoutMs: 30 });
    const gate = deferred<string>();
    let signal!: AbortSignal;
    const pending = session.login(interaction(life => { signal = life; return gate.promise; }));
    const pendingError = pending.then(() => { throw new Error('saved'); }, error => error);
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    session.cancel();
    await expect(pendingError).resolves.toBeInstanceOf(DevinError);
    expect(String(await pendingError)).toContain('cancelled');
    expect(signal.aborted).toBe(true);
    gate.resolve('expired-code-SECRET');
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await store.read()).toBeUndefined();
    expect(await session.status()).toBe('Login cancelled.');
    expect(await session.status()).not.toContain('SECRET');

    const timed = new AuthSession(store, { fetcher, timeoutMs: 20 });
    let timedSignal!: AbortSignal;
    const timedLogin = timed.login(interaction(life => {
      timedSignal = life;
      return new Promise((_resolve, reject) => life.addEventListener('abort', () => reject(new DevinError('cancelled', 'Devin operation cancelled or timed out.')), { once: true }));
    }));
    const timedError = timedLogin.then(() => { throw new Error('saved'); }, error => error);
    await expect(timedError).resolves.toBeInstanceOf(DevinError);
    expect(String(await timedError)).toContain('cancelled');
    expect(timedSignal.aborted).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();

    const hanging = deferred<string>();
    const disposeSession = new AuthSession(store, { fetcher, timeoutMs: 60_000 });
    let prompted = false;
    const login = disposeSession.login(interaction(signal => {
      prompted = true;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DevinError('cancelled', 'Devin operation cancelled or timed out.')), { once: true }));
    }));
    const loginError = login.then(() => { throw new Error('saved'); }, error => error);
    await vi.waitFor(() => expect(prompted).toBe(true));
    const firstDispose = disposeSession.dispose();
    const secondDispose = disposeSession.dispose();
    await firstDispose; await secondDispose;
    await expect(loginError).resolves.toBeInstanceOf(DevinError);
    expect(await store.read()).toBeUndefined();
    await disposeSession.dispose();
    await expect(disposeSession.login(interaction(async () => 'nope'))).rejects.toThrow('unavailable');
  });

  it('suppresses a stale commit on cancel and deletes an admitted write on logout', async () => {
    const dir = await tempDir(); dirs.push(dir);
    const entered = deferred(); const release = deferred();
    let commits = 0;
    const store = new AuthStore(dir, { beforeCommit: async () => { commits++; entered.resolve(); await release.promise; } });
    const api = await server((_req, res) => res.end('{"token":"fixture-admitted-SECRET"}'));
    closers.push(api.close);
    const session = new AuthSession(store, { apiBase: api.base });
    const login = session.login(interaction(async () => 'fixture-code-SECRET'));
    const loginError = login.then(() => { throw new Error('saved'); }, error => error);
    await entered.promise;
    session.cancel();
    release.resolve();
    await expect(loginError).resolves.toBeInstanceOf(DevinError);
    expect(String(await loginError)).toMatch(/withdrawn|cancelled/);
    expect(await store.read()).toBeUndefined();
    expect(commits).toBe(1);

    const enteredAgain = deferred(); const releaseAgain = deferred();
    const store2 = new AuthStore(dir, { beforeCommit: async () => { enteredAgain.resolve(); await releaseAgain.promise; } });
    const session2 = new AuthSession(store2, { apiBase: api.base });
    const again = session2.login(interaction(async () => 'fixture-code-SECRET'));
    const againError = again.then(() => { throw new Error('saved'); }, error => error);
    await enteredAgain.promise;
    const logout = session2.logout();
    releaseAgain.resolve();
    await logout;
    await expect(againError).resolves.toBeInstanceOf(DevinError);
    expect(String(await againError)).toMatch(/withdrawn|cancelled/);
    expect(await store2.read()).toBeUndefined();
    expect(await session2.status()).toContain('Logged out');
    expect(await session2.status()).not.toContain('SECRET');
  });

  it('revokes only a matching token when the revoke is queued behind a newer commit', async () => {
    const dir = await tempDir(); dirs.push(dir);
    const seed = new AuthStore(dir);
    const old: Grant = { version: 1, token: 'devin-session-token$old-token', expiresAt: Date.now() - 1_000, expirySource: 'fallback' };
    await seed.write(old);
    const entered = deferred(); const release = deferred();
    const store = new AuthStore(dir, { beforeCommit: async () => { entered.resolve(); await release.promise; } });
    const api = await server((_req, res) => res.end('{"token":"new-token-SECRET"}'));
    closers.push(api.close);
    const session = new AuthSession(store, { apiBase: api.base });
    const login = session.login(interaction(async () => 'fixture-code'));
    await entered.promise;
    const revoke = session.revoke(old.token);
    release.resolve();
    await login; await revoke;
    const saved = await store.read();
    expect(saved?.token).toBe('devin-session-token$new-token-SECRET');
    expect(saved?.revoked).toBeUndefined();
    expect(session.available()).toBe(true);
    await session.revoke('new-token-SECRET');
    expect(session.available()).toBe(false);
    await expect(session.access()).rejects.toThrow('revoked');
    expect(await session.status()).toContain('rejected');
    expect(await session.status()).not.toContain('SECRET');
    expect(await session.status()).not.toMatch(/refresh available/i);
  });

  it('treats expiry as terminal, refreshes the snapshot on access, and aborts the previous search signal', async () => {
    const { dir, session, store, invalidated } = await fixture();
    const expired: Grant = { version: 1, token: 'devin-session-token$expired-SECRET', expiresAt: Date.now() - 5_000, expirySource: 'fallback' };
    await store.write(expired);
    expect(await session.status()).toContain('Session expired');
    expect(await session.status()).toContain('no automatic refresh');
    expect(await session.status()).not.toContain('SECRET');
    await expect(session.access()).rejects.toThrow('expired');
    expect(session.available()).toBe(false);

    const fresh: Grant = { version: 1, token: 'devin-session-token$fresh-token', expiresAt: Date.now() + 60_000, expirySource: 'fallback' };
    await store.write(fresh);
    const first = await session.access();
    expect(first.token).toBe(fresh.token);
    const before = invalidated.length;
    const replacement: Grant = { version: 1, token: 'devin-session-token$rotated-token', expiresAt: Date.now() + 60_000, expirySource: 'jwt' };
    await new AuthStore(dir).write(replacement);
    const second = await session.access();
    expect(second.token).toBe(replacement.token);
    expect(first.signal.aborted).toBe(true);
    expect(invalidated.length).toBeGreaterThan(before);
    session.cancel();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    const third = await session.access();
    expect(third.signal.aborted).toBe(false);
    const caller = new AbortController();
    caller.abort();
    await expect(session.access(caller.signal)).rejects.toThrow('cancelled');
    const linked = new AbortController();
    const live = session.access(linked.signal);
    const got = await live;
    linked.abort();
    expect(got.signal.aborted).toBe(true);
  });

  it('supports optional loopback without a code prompt and hides provider failures', async () => {
    const api = await server((req, res) => { void body(req).then(() => res.end('{"token":"loopback-token"}')); });
    closers.push(api.close);
    const { session, store } = await fixture({ mode: 'loopback', port: 0, apiBase: api.base, statusHoldMs: 0 });
    const notice = deferred<string>();
    const prompt = vi.fn(async () => 'should-not-prompt');
    const pending = session.login(interaction(prompt, url => notice.resolve(url)));
    const url = new URL(await notice.promise);
    expect(url.searchParams.get('redirect_uri')).toContain('127.0.0.1');
    await fetch(`${url.searchParams.get('redirect_uri')}?state=${url.searchParams.get('state')}&code=loop-code`);
    expect(await pending).toBe('Login saved.');
    expect(prompt).not.toHaveBeenCalled();
    expect((await store.read())?.token).toBe('devin-session-token$loopback-token');
    expect(String(await session.status())).not.toContain('loop-code');

    const leak = 'super-secret-code';
    const { session: broken } = await fixture({
      fetcher: async () => new Response(`${leak} AND provider-secret`, { status: 400 }),
    });
    const notify = vi.fn();
    await expect(broken.login(interaction(async () => leak, notify))).rejects.toThrow(/^Devin token exchange failed/);
    try { await broken.login(interaction(async () => leak, notify)); } catch (error) {
      expect(String(error)).not.toContain(leak);
      expect(String(error)).not.toContain('provider-secret');
      expect(error).toBeInstanceOf(DevinError);
    }
    expect(await broken.status()).not.toContain(leak);
    expect(notify.mock.calls.flat().join(' ')).not.toContain(leak);
  });

  it('bounds expiry before ISO formatting and does not throw RangeError from status', async () => {
    expect(formatExpiry(1_700_000_000_000)).toBe(new Date(1_700_000_000_000).toISOString());
    expect(formatExpiry(Number.MAX_VALUE)).toBeUndefined();
    expect(formatExpiry(EXPIRY_TIME_MAX + 1)).toBeUndefined();
    expect(formatExpiry(1.5)).toBeUndefined();
    const { dir, session } = await fixture();
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(dir, 'devin-search'), { recursive: true });
    await writeFile(join(dir, 'devin-search', 'credentials.json'), JSON.stringify({
      version: 1, token: 'devin-session-token$range-SECRET', expiresAt: Number.MAX_VALUE, expirySource: 'fallback',
    }));
    await expect(session.status()).rejects.toThrow('invalid');
    try { await session.status(); } catch (error) {
      expect(error).not.toBeInstanceOf(RangeError);
      expect(String(error)).not.toContain('SECRET');
    }
  });

  it('applies a login mode parameter without replacing a pending owner', async () => {
    const { session } = await fixture({ fetcher: vi.fn() });
    const gate = deferred<string>();
    let prompts = 0;
    const first = session.login(interaction(async () => { prompts++; return gate.promise; }), liveSignal(), 'code');
    const firstError = first.then(() => { throw new Error('saved'); }, error => error);
    await vi.waitFor(() => expect(prompts).toBe(1));
    const extraNotify = vi.fn();
    await expect(session.login(interaction(async () => 'other-code', extraNotify), liveSignal(), 'loopback')).resolves.toBe('Login already pending.');
    expect(extraNotify).not.toHaveBeenCalled();
    session.cancel();
    await expect(firstError).resolves.toBeInstanceOf(DevinError);
    const api = await server((_req, res) => res.end('{"token":"param-loopback"}'));
    closers.push(api.close);
    const { session: next } = await fixture({ apiBase: api.base, port: 0, statusHoldMs: 0 });
    const notice = deferred<string>();
    const prompt = vi.fn(async () => 'should-not-prompt');
    const pending = next.login(interaction(prompt, url => notice.resolve(url)), liveSignal(), 'loopback');
    const url = new URL(await notice.promise);
    expect(url.searchParams.get('redirect_uri')).toContain('127.0.0.1');
    await fetch(`${url.searchParams.get('redirect_uri')}?state=${url.searchParams.get('state')}&code=loop-code`);
    expect(await pending).toBe('Login saved.');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not import pi or DSH from the auth sources', async () => {
    for (const file of ['store.ts', 'session.ts']) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/from ['"]@earendil|from ['"]@deepseek|from ['"]pi['"]/);
    }
    const sessionSource = await readFile(new URL('../src/session.ts', import.meta.url), 'utf8');
    expect(sessionSource).toContain('../../../src/oauth.js');
    expect(sessionSource).toContain('../../../src/search-session.js');
    expect(sessionSource).not.toMatch(/refresh available/i);
  });
});
