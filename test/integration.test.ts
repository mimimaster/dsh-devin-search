import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolCallId } from '@deepseek-ai/dsh-llm';
import * as Plugin from '../src/index.js';
import { KEY } from '../src/session.js';
import { Writer, decode, stringField } from '../src/protobuf.js';
import { frame, gzipFrame, JWT_PATH, STREAM_PATH } from '../src/protocol.js';
import { WEB_PATH } from '../src/web.js';
import { body, cleanup, command, deferred, harness, liveSignal, otherKey, server, store, temp } from './helpers.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function home() { const dir = await temp(); cleanups.push(() => cleanup(dir)); return dir; }
async function callback(text: string) {
  const match = /https?:\/\/[^\s]+/.exec(text); if (!match) throw new Error(`Missing auth URL: ${text}`);
  const url = new URL(match[0]); return fetch(`${url.searchParams.get('redirect_uri')}?state=${url.searchParams.get('state')}&code=fixture-code`);
}
async function saved(h: Awaited<ReturnType<typeof harness>>) { await vi.waitFor(async () => { expect(await h.sessions.status()).toContain('Logged in'); }); }
const callId = 'fixture-call' as ToolCallId;
describe('genuine Cordis seams + credentials-local persistence', () => {
  it('codeSearch switch unregisters only code_search, retaining auth and the web provider', async () => {
    expect(Plugin.Config({}).codeSearch.get()).toBe(true);
    expect(Plugin.Config({}).webSearch.get()).toBe(true);
    // @ts-expect-error verify runtime validation of malformed external config
    expect(() => Plugin.Config({ codeSearch: 'false' })).toThrow();
    const h = await harness(await home(), { web: { fetcher: async () => new Response('{"results":[{"url":"https://example.test","title":"web still enabled"}]}') } }, { codeSearch: false });
    cleanups.push(() => h.close()); await store(h);
    expect(h.ctx.tools.schemas().map(t => t.name)).not.toContain('code_search');
    expect(h.ctx.authorization.describe(KEY)).toBeDefined();
    expect((await h.ctx.web.search({ query: 'fixture' })).sources).toHaveLength(1);
    const result = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: {}, agent: h.agent, signal: liveSignal() });
    expect(result.isError).toBe(true);
  });
  it('failed code_search is a native failed tool result, never a successful empty match', async () => {
    const h = await harness(await home(), { completion: { complete: async () => '[TOOL_CALLS]restricted_exec{broken' } });
    cleanups.push(() => h.close()); await store(h);
    const result = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: { search_term: 'x', search_folder_absolute_uri: h.agent.session.header.cwd }, agent: h.agent, signal: liveSignal() });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Error: Invalid Devin JSON response.' }]);
    expect(result).not.toHaveProperty('value');
  });
  it('native slash login waits until callback; atomic 0600 save, restart, shared web/code search and logout', async () => {
    const dir = await home(); await writeFile(join(dir, 'a.ts'), 'export const target = 42;\n');
    let streamCalls = 0; let webToken = ''; let jwtToken = '';
    const api = await server((req, res) => { void body(req).then(bytes => {
      if (req.url === '/auth/cli/token') { res.end(JSON.stringify({ token: 'fixture-shared-token' })); return; }
      if (req.url === WEB_PATH) { webToken = JSON.parse(bytes.toString()).metadata.apiKey; res.end('{"results":[{"title":"fixture","url":"https://example.test"}]}'); return; }
      if (req.url === JWT_PATH) { jwtToken = stringField(decode(decode(bytes)[0]!.value as Buffer), 3)!; res.end(new Writer().string(1, 'fixture-search-jwt').build()); return; }
      if (req.url === STREAM_PATH) {
        const text = streamCalls++ === 0 ? '[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"op":"readfile","path":"/codebase/a.ts","start":1,"end":1}}' : '<ANSWER><file path="/codebase/a.ts"><range>1-1</range></file></ANSWER>';
        res.end(Buffer.concat([gzipFrame(new Writer().string(2, text).build()), frame(Buffer.from('{}'), 2)])); return;
      }
      res.writeHead(404).end();
    }); }); cleanups.push(api.close);
    const options = { oauth: { port: 0, webBase: api.base, apiBase: api.base }, web: { hosts: [api.base] }, cloud: { base: api.base } };
    const first = await harness(dir, options);
    expect(first.ctx.authorization.describe(KEY)?.methods[0]?.id).toBe('oauth');
    // Login stays running until OAuth finishes so the UI card can settle on the final outcome.
    const loginP = command(first, '/devin-login');
    await vi.waitFor(() => expect(first.sessions.getPendingAuthUrl()).toBeTruthy());
    expect((await command(first, '/devin-status'))?.result).toMatchObject({ text: 'Login pending.' });
    await callback(first.sessions.getPendingAuthUrl()!);
    const login = await loginP;
    expect(login?.result).toMatchObject({ kind: 'success', text: 'Login saved.' });
    await saved(first);
    expect((await stat(join(dir, '.credentials.yaml'))).mode & 0o777).toBe(0o600);
    // The only secret-bearing YAML is the HOST-managed credential store, not composition.
    expect(await readFile(join(dir, '.credentials.yaml'), 'utf8')).toContain('devin-search/session');
    expect(JSON.stringify(first.events)).not.toContain('fixture-shared-token');
    await first.close();
    const second = await harness(dir, options); cleanups.push(() => second.close());
    expect(await second.sessions.status()).toContain('Logged in');
    expect((await second.ctx.web.search({ query: 'fixture', maxResults: 1 })).sources).toHaveLength(1);
    const result = await second.ctx.tools.execute({ callId, name: 'code_search', arguments: { search_term: 'target', search_folder_absolute_uri: dir }, agent: second.agent, signal: liveSignal() });
    expect(result.isError).toBe(false); expect(result.value).toMatchObject({ status: 'success', files: [{ path: join(dir, 'a.ts') }] });
    expect(result.content).toEqual([{ type: 'text', text: `${join(dir, 'a.ts')}\n1: export const target = 42;` }]);
    // OAuth bare token is normalized to Windsurf wire form on every access().
    expect(webToken).toBe('devin-session-token$fixture-shared-token'); expect(jwtToken).toBe(webToken);
    expect((await command(second, '/devin-logout'))?.result.kind).toBe('success');
    expect(await second.ctx.credentials.readRecord(KEY)).toBeUndefined(); expect(second.sessions.available()).toBe(false);
  });
  it('native authorization UI flow, logout during exchange cannot resurrect a grant', async () => {
    const dir = await home(); const exchange = deferred(); const release = deferred(); const notice = deferred<string>();
    const api = await server((_req, res) => { exchange.resolve(); void release.promise.then(() => res.end('{"token":"fixture-delayed"}')); }); cleanups.push(api.close);
    const h = await harness(dir, { oauth: { port: 0, apiBase: api.base } }); cleanups.push(() => h.close());
    const flow = h.ctx.authorization.begin({ key: KEY, interaction: { notify: n => { if (n.url) notice.resolve(n.url); }, prompt: async () => '' } });
    await callback(await notice.promise); await exchange.promise; await h.sessions.logout(); release.resolve();
    expect((await flow).status).toBe('cancelled'); expect(await h.ctx.credentials.readRecord(KEY)).toBeUndefined();
    await vi.waitFor(() => expect(h.ctx.authorization.describe(KEY)?.inFlight).toBe(false));
  });
  it('logout waits for already-admitted atomic commit, then deletes (command and native machinery share lock)', async () => {
    const dir = await home(); const api = await server((_req, res) => res.end('{"token":"fixture-admitted"}')); cleanups.push(api.close);
    const h = await harness(dir, { oauth: { port: 0, apiBase: api.base } }); cleanups.push(() => h.close());
    const admitted = deferred(); const release = deferred();
    const original = h.ctx.credentials.modifyRecord.bind(h.ctx.credentials);
    const spy = vi.spyOn(h.ctx.credentials, 'modifyRecord').mockImplementation(async (key, mutate) => { admitted.resolve(); await release.promise; return original(key, mutate); });
    const notice = deferred<string>(); const flow = h.ctx.authorization.begin({ key: KEY, interaction: { notify: n => { if (n.url) notice.resolve(n.url); }, prompt: async () => '' } });
    await callback(await notice.promise); await admitted.promise; const logout = h.sessions.logout(); release.resolve(); await logout; await flow;
    expect(await h.ctx.credentials.readRecord(KEY)).toBeUndefined(); spy.mockRestore();
  });
  it('isolated real store read-modify-write preserves unrelated entries across concurrent owners and restart', async () => {
    const dir = await home(); const a = await harness(dir); const b = await harness(dir);
    await Promise.all([store(a), b.ctx.credentials.modifyRecord(otherKey, async () => ({ kind: 'grant', payload: { fixture: 'not-a-secret' } }))]);
    await a.close(); await b.close();
    const resumed = await harness(dir); cleanups.push(() => resumed.close());
    expect(await resumed.ctx.credentials.readRecord(otherKey)).toEqual({ kind: 'grant', payload: { fixture: 'not-a-secret' } });
    expect(await resumed.sessions.status()).toContain('Logged in'); await resumed.sessions.logout();
    expect(await resumed.ctx.credentials.readRecord(otherKey)).toBeDefined();
  });
  it('plugin unload removes flow/commands/tools/provider, cancels pending server; production export mounts too', async () => {
    const dir = await home(); const h = await harness(dir, { oauth: { port: 0 } }); cleanups.push(() => h.close());
    const loginP = command(h, '/devin-login');
    await vi.waitFor(() => expect(h.sessions.getPendingAuthUrl()).toBeTruthy());
    const url = new URL(h.sessions.getPendingAuthUrl()!);
    await h.plugin.dispose();
    await loginP; // settles as cancelled/error after dispose
    expect(h.ctx.authorization.describe(KEY)).toBeUndefined(); expect(h.ctx.commands.find(h.agent, 'devin-login')).toBeUndefined();
    const unknown = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: {}, signal: liveSignal() }); expect(unknown.isError).toBe(true);
    await expect(h.ctx.web.search({ query: 'x' })).rejects.toThrow('not registered');
    await vi.waitFor(async () => { await expect(fetch(url.searchParams.get('redirect_uri')!)).rejects.toThrow(); });
    const production = h.ctx.plugin(Plugin); await production.await(); expect(h.ctx.authorization.describe(KEY)).toBeDefined(); await production.dispose();
  });
  it('no session cwd is refused and canonical schema/extra argument validation is enforced by native dispatch', async () => {
    const dir = await home(); const h = await harness(dir, { completion: { async complete() { throw new Error('must not run'); } } }); cleanups.push(() => h.close()); await store(h);
    const missing = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: { search_term: 'x', search_folder_absolute_uri: dir }, signal: liveSignal() });
    expect(missing.isError).toBe(true); expect(missing.error?.message).toContain('authoritative');
    const invalid = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: { search_term: 123 }, signal: liveSignal() }); expect(invalid.isError).toBe(true);
    const extra = await h.ctx.tools.execute({ callId, name: 'code_search', arguments: { search_term: 'x', search_folder_absolute_uri: dir, shell: 'evil' }, signal: liveSignal() }); expect(extra.isError).toBe(true); expect(extra.error?.message).toContain('Only search_term');
  });
});
