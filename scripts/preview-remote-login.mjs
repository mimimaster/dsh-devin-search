// Isolated QA only. Build first; optional argv[2] is an installed DSH client-connection/lib/index.js.
// Real Connection authentication + plugin UI/API/credentials, synthetic PKCE provider, temporary store.
import { Context } from '@deepseek-ai/cordis';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import Authorization from '@deepseek-ai/dsh-authorization';
import Commands from '@deepseek-ai/dsh-commands';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import Web from '@deepseek-ai/dsh-web';
import { createScope } from '@deepseek-ai/dsh-scope';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRuntime, inject } from '../dist/index.js';
const Connection = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@deepseek-ai/dsh-client-connection');
const bundle = execFileSync('npx', ['--no-install', 'esbuild', 'test/fixtures/remote-login-preview.tsx', '--bundle', '--format=esm', '--platform=browser', '--jsx=automatic', '--minify'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const home = await mkdtemp(join(tmpdir(), 'dsh-remote-login-preview-'));
const ctx = new Context();
const credentials = ctx.plugin(Credentials, { dshHome: home, watch: false });
await credentials.await();
const fibers = [credentials, ctx.plugin(Authorization), ctx.plugin(Commands), ctx.plugin(FileSystem), ctx.plugin(SystemPrompt), ctx.plugin(Tools), ctx.plugin(Agents), ctx.plugin(Web)];
await Promise.all(fibers.map(fiber => fiber.await()));
const transport = ctx.plugin(Connection); await transport.await(); fibers.push(transport);
const connection = ctx.get('connection');
if (!connection) throw new Error('Native Connection did not activate.');
let sessions; let expectedChallenge; let exchanges = 0; const events = [];
const plugin = ctx.plugin({ name: 'devin-search-preview', inject, async apply(scope) {
  sessions = await createRuntime(scope, { oauth: { fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
    exchanges++;
    if (body.code !== 'fixture-preview-code' || challenge !== expectedChallenge) return new Response('synthetic rejection', { status: 400 });
    expectedChallenge = undefined;
    return new Response('{"token":"fixture-preview-only-token"}');
  } } });
} });
await plugin.await();
const agent = { id: 'fixture-agent', session: { id: 'fixture-agent', header: { cwd: home }, async append(event) { events.push(event); } } };
const scope = createScope(plugin.ctx, agent); agent.ctx = scope.ctx;
const leave = ctx.agents.enter(agent, undefined); await ctx.agents.announce(agent, 'startup');
const api = connection.createSharedFetchHandler('/api');
const app = createServer((req, res) => { void serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Fixture error'); }); });
async function serve(req, res) {
  const url = new URL(req.url, 'http://fixture.internal');
  // Test-only bootstrap for this empty, loopback-bound fixture; never expose a launch token in logs.
  if (url.pathname === '/fixture/bootstrap' && req.method === 'GET') {
    const launch = new URL(connection.authenticatedUrl(base)); req.url = launch.pathname + launch.search;
    connection.authorizeIndex(req, res); return;
  }
  if (url.pathname === '/') {
    if (!connection.authorizeIndex(req, res)) return;
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remote login fixture</title><style>body{margin:0;background:var(--ink-s1);color:var(--ink-t1);font-family:system-ui}button{cursor:pointer;margin-bottom:16px}code{overflow-wrap:break-word}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return;
  }
  const rejected = connection.requestRejection(req);
  if (rejected) { res.writeHead(rejected).end('refused'); return; }
  if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return; }
  if (url.pathname === '/fixture/start' && req.method === 'POST') {
    await sessions.logout();
    const result = await ctx.commands.execute(agent, '/devin-login', [], new AbortController().signal);
    const authUrl = sessions.getPendingAuthUrl();
    if (!authUrl) { res.writeHead(500).end('No auth URL'); return; }
    expectedChallenge = new URL(authUrl).searchParams.get('code_challenge');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ kind: 'command', commandId: String(events.length), name: 'devin-login', args: null, time: Date.now(), outcome: result.result })); return;
  }
  if (url.pathname === '/fixture/stats') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ exchanges, loggedIn: sessions.available(), sensitiveInChat: /fixture-preview-(?:code|only-token)/.test(JSON.stringify(events)) })); return;
  }
  if (url.pathname.startsWith('/api/')) {
    const abort = new AbortController(); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const request = new Request(url, { method: req.method, headers: new Headers(Object.entries(req.headers).filter(([, value]) => typeof value === 'string')), signal: abort.signal,
      ...(req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
    const response = await api.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
  }
  res.writeHead(404).end();
}
await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.address().port}/`;
console.log('Isolated QA launch URL:', `${base}fixture/bootstrap`);
console.log('Synthetic provider only. No production credentials. Base:', base);
async function close() {
  app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
  leave(); await scope.dispose(); await plugin.dispose();
  for (const fiber of fibers.reverse()) await fiber.dispose();
  await rm(home, { recursive: true, force: true });
}
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { void close().then(() => process.exit(0)); });
