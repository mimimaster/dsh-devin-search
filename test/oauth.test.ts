import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { oauth } from '../src/oauth.js';
import { expiry } from '../src/safety.js';
import { body, deferred, liveSignal, server } from './helpers.js';

describe('loopback PKCE OAuth (localhost only)', () => {
  it('validates code/state/S256; wrong-state noise does not cancel; server closes', async () => {
    let exchanged: { code: string; code_verifier: string } | undefined;
    const api = await server((req, res) => { void body(req).then(bytes => { exchanged = JSON.parse(bytes.toString()); res.end(JSON.stringify({ token: 'fixture-only-session' })); }); });
    const notice = deferred<string>();
    const result = oauth(liveSignal(), notice.resolve, { port: 0, webBase: api.base, apiBase: api.base });
    const url = new URL(await notice.promise); const redirect = url.searchParams.get('redirect_uri')!;
    expect(url.pathname).toBe('/auth/cli/continue'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const bad = await fetch(`${redirect}?state=wrong&code=fixture`); expect(bad.status).toBe(400);
    expect((await fetch(`${redirect}?state=${url.searchParams.get('state')}&code=`)).status).toBe(400);
    const statusUrl = redirect.replace(/\/callback$/, '/status');
    expect(await (await fetch(statusUrl)).json()).toEqual({ phase: 'pending' });
    expect((await fetch(`${redirect}?state=${url.searchParams.get('state')}&code=fixture-code`)).status).toBe(200);
    expect(await result).toBe('fixture-only-session');
    expect(exchanged?.code).toBe('fixture-code');
    expect(createHash('sha256').update(exchanged!.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    // Terminal phase stays readable so the login card can flip without /devin-status.
    expect(await (await fetch(statusUrl)).json()).toEqual({ phase: 'authorized' });
    // First terminal status read releases the hold; server then closes.
    await vi.waitFor(async () => { await expect(fetch(redirect)).rejects.toThrow(); });
    await api.close();
  });
  it('falls back from an occupied preferred port', async () => {
    const occupied = await server((_req, res) => res.end()); const controller = new AbortController(); const notice = deferred<string>();
    const result = oauth(controller.signal, notice.resolve, { port: occupied.port }); const rejection = expect(result).rejects.toThrow('cancelled');
    const url = new URL(await notice.promise); expect(new URL(url.searchParams.get('redirect_uri')!).port).not.toBe(String(occupied.port));
    controller.abort(); await rejection; await occupied.close();
  });
  it('timeout closes the callback and preabort never starts one', async () => {
    const notice = deferred<string>(); const result = oauth(liveSignal(), notice.resolve, { port: 0, timeoutMs: 80 });
    const rejected = expect(result).rejects.toThrow('cancelled'); const url = new URL(await notice.promise);
    await rejected; await expect(fetch(url.searchParams.get('redirect_uri')!)).rejects.toThrow();
    let notified = false; const controller = new AbortController(); controller.abort('do not echo this reason');
    await expect(oauth(controller.signal, () => { notified = true; })).rejects.toThrow('cancelled'); expect(notified).toBe(false);
  });
  it('cancels hung token exchange and redacts provider error bodies', async () => {
    const controller = new AbortController(); const received = deferred();
    const api = await server((_req, _res) => { received.resolve(); }); const notice = deferred<string>();
    const result = oauth(controller.signal, notice.resolve, { port: 0, apiBase: api.base }); const rejected = expect(result).rejects.toThrow('cancelled');
    const url = new URL(await notice.promise); await fetch(`${url.searchParams.get('redirect_uri')}?state=${url.searchParams.get('state')}&code=x`);
    await received.promise; controller.abort(); await rejected; await api.close();
    const leak = await server((_req, res) => { res.writeHead(500).end('SUPER_SECRET_TOKEN'); }); const next = deferred<string>();
    const badResult = oauth(liveSignal(), next.resolve, { port: 0, apiBase: leak.base }); const bad = expect(badResult).rejects.toThrow(/^Devin token exchange failed/);
    const nextUrl = new URL(await next.promise); await fetch(`${nextUrl.searchParams.get('redirect_uri')}?state=${nextUrl.searchParams.get('state')}&code=x`); await bad; await leak.close();
  });
  it('records JWT expiry or conservative opaque fallback, never refresh', () => {
    const token = `header.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')}.sig`;
    expect(expiry(token)).toEqual({ expiresAt: 2_000_000_000_000 - 60_000, expirySource: 'jwt' });
    expect(expiry('opaque', 100)).toEqual({ expiresAt: 86_400_100, expirySource: 'fallback' });
  });
});
