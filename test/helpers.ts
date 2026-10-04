import { Context } from '@deepseek-ai/cordis';
import Authorization from '@deepseek-ai/dsh-authorization';
import Commands from '@deepseek-ai/dsh-commands';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Web from '@deepseek-ai/dsh-web';
import Agents, { type Agent } from '@deepseek-ai/dsh-agent';
import { createScope } from '@deepseek-ai/dsh-scope';
import type { LiveConfig } from '../src/settings.js';
import { createRuntime, inject, type FixtureOptions, type Config } from '../src/index.js';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { KEY } from '../src/session.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const liveSignal = () => new AbortController().signal;
export const temp = async () => realpath(await mkdtemp(join(tmpdir(), 'dsh-devin-fixture-')));
export function deferred<T = void>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject };
}
export async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address(); if (!address || typeof address === 'string') throw new Error('bind');
  return { base: `http://127.0.0.1:${address.port}`, port: address.port, close: () => new Promise<void>(resolve => { instance.close(() => resolve()); instance.closeAllConnections(); }) };
}
export async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}
export async function harness(home: string, options: FixtureOptions = {}, config: Config | LiveConfig = {}) {
  const ctx = new Context();
  const fibers = [
    ctx.plugin(Credentials, { dshHome: home, watch: false }), ctx.plugin(Authorization), ctx.plugin(Commands), ctx.plugin(FileSystem), ctx.plugin(SystemPrompt), ctx.plugin(Tools), ctx.plugin(Agents), ctx.plugin(Web, { searchProvider: 'devin', fetchProvider: 'http' }),
  ];
  await Promise.all(fibers.map(f => f.await()));
  let sessions!: Awaited<ReturnType<typeof createRuntime>>;
  const plugin = ctx.plugin({ name: 'devin-search-fixture', inject, async apply(child: Context) { sessions = await createRuntime(child, options, config); } });
  await plugin.await();
  const events: unknown[] = [];
  // Only the agent's session log and cwd are needed by native command/tool dispatch.
  const agent = { id: 'fixture-agent', session: { id: 'fixture-agent', header: { cwd: home }, async append(event: unknown) { events.push(event); } } } as unknown as Agent;
  const scope = createScope(plugin.ctx, agent); Object.assign(agent, { ctx: scope.ctx });
  const unregister = ctx.agents.enter(agent, undefined); await ctx.agents.announce(agent, 'startup');
  return { ctx, plugin, sessions, agent, events, async close() { unregister(); await scope.dispose(); await plugin.dispose(); for (const f of fibers.reverse()) await f.dispose(); } };
}
export async function store(h: Awaited<ReturnType<typeof harness>>, token = 'fixture-session-A', expiresAt = Date.now() + 3600_000) {
  await h.ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { version: 1, token, expiresAt, expirySource: 'fallback' } }));
  await h.sessions.reload();
}
export async function command(h: Awaited<ReturnType<typeof harness>>, line: string, signal = liveSignal()) {
  return h.ctx.commands.execute(h.agent, line, [], signal);
}
export const otherKey = credentialKey('fixture', 'unrelated');
export const cleanup = (path: string) => rm(path, { recursive: true, force: true });
