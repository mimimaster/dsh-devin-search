import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { install, type ExtensionDeps } from '../src/extension.js';
import { createSearchRuntime } from '../src/runtime.js';
import { cleanup, liveSignal, tempDir } from './helpers.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(cleanup)); });

interface Harness {
  pi: ExtensionAPI;
  commands: Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
  tools: Map<string, ToolDefinition>;
  handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>;
  active: string[];
  appendEntry: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
  foreign: Array<{ name: string; sourceInfo: { path: string; source: string; scope: 'user'; origin: 'top-level' } }>;
}

function harness(foreign: Harness['foreign'] = []): Harness {
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
  const active = ['read', ...foreign.map(tool => tool.name)];
  const appendEntry = vi.fn();
  const sendUserMessage = vi.fn();
  const pi = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) {
      commands.set(name, options);
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
      if (!active.includes(tool.name)) active.push(tool.name);
    },
    getAllTools() {
      const ours = [...tools.values()].map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        promptGuidelines: tool.promptGuidelines,
        exposure: tool.exposure ?? 'direct',
        annotations: tool.annotations,
        sourceInfo: { path: 'pi-devin-search', source: 'package', scope: 'user' as const, origin: 'package' as const },
      }));
      const foreignInfo = foreign.filter(tool => !tools.has(tool.name)).map(tool => ({
        name: tool.name,
        description: 'other',
        parameters: {},
        exposure: 'direct' as const,
        sourceInfo: tool.sourceInfo,
      }));
      return [...foreignInfo, ...ours];
    },
    getActiveTools() { return [...active]; },
    setActiveTools(names: string[]) { active.splice(0, active.length, ...names); },
    appendEntry,
    sendUserMessage,
  } as unknown as ExtensionAPI;
  return { pi, commands, tools, handlers, active, appendEntry, sendUserMessage, foreign };
}

function ctx(partial: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  const notify = vi.fn();
  const select = vi.fn(async () => undefined);
  const input = vi.fn(async () => undefined);
  return {
    ui: { notify, select, input, setStatus: vi.fn(), confirm: vi.fn(async () => false) },
    hasUI: true,
    mode: 'tui',
    cwd: '/tmp/workspace',
    signal: undefined,
    ...partial,
  } as unknown as ExtensionCommandContext;
}

async function boot(deps: ExtensionDeps = {}, foreign: Harness['foreign'] = []) {
  const dir = await tempDir();
  dirs.push(dir);
  const h = harness(foreign);
  install(h.pi, { agentDir: () => dir, ...deps });
  const start = h.handlers.get('session_start')?.[0];
  if (!start) throw new Error('missing session_start');
  const context = ctx({ cwd: dir });
  await start({ type: 'session_start', reason: 'startup' }, context);
  return { dir, h, context };
}

describe('pi devin search extension', () => {
  it('registers commands in the factory and does not create a runtime or call getAgentDir', () => {
    const agentDir = vi.fn(() => { throw new Error('factory side effect'); });
    const h = harness();
    install(h.pi, { agentDir });
    expect([...h.commands.keys()]).toEqual(['devin-login', 'devin-status', 'devin-logout', 'devin-cancel', 'devin-settings']);
    expect(h.tools.size).toBe(0);
    expect(agentDir).not.toHaveBeenCalled();
  });

  it('registers tool schemas at session_start, including optional structured output and cloud annotations', async () => {
    const { h } = await boot();
    for (const name of ['web_search', 'code_search']) {
      const tool = h.tools.get(name);
      expect(tool?.parameters).toBeTruthy();
      expect(tool?.outputSchema).toBeTruthy();
      expect(tool?.executionMode).toBe('sequential');
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    }
    expect(h.active).toEqual(expect.arrayContaining(['web_search', 'code_search', 'read']));
  });

  it('loads startup settings and enforces disable inside execute, not only by hiding the tool', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    await mkdir(join(dir, 'devin-search'), { recursive: true });
    await writeFile(join(dir, 'devin-search', 'settings.json'), JSON.stringify({ webSearch: false, codeSearch: false }));
    const { h, context } = await boot({ agentDir: () => dir });
    expect(h.active).not.toContain('web_search');
    expect(h.active).not.toContain('code_search');
    expect(h.active).toContain('read');
    const web = h.tools.get('web_search');
    const code = h.tools.get('code_search');
    const toolCtx = context as unknown as Parameters<NonNullable<typeof web>['execute']>[4];
    await expect(web?.execute('id', { query: 'q' }, liveSignal(), undefined, toolCtx)).rejects.toThrow('web_search is disabled');
    await expect(code?.execute('id', { search_term: 'q', search_folder_absolute_uri: dir }, liveSignal(), undefined, toolCtx)).rejects.toThrow('code_search is disabled');
  });

  it.each(['disabled', 'enabled', 'malformed startup'])('rejects cached tools after corruption (%s) before provider, session, or network access', async state => {
    const dir = await tempDir();
    dirs.push(dir);
    const denied = async (): Promise<never> => { throw new Error('unexpected downstream access'); };
    const fetcher = vi.fn(denied);
    const complete = vi.fn(denied);
    const runtime = createSearchRuntime(dir, {
      oauth: { fetcher }, web: { fetcher }, completion: { complete },
    });
    const file = join(dir, 'devin-search', 'settings.json');
    await runtime.settings.update({ webSearch: state === 'enabled', codeSearch: state === 'enabled' });
    if (state === 'malformed startup') await writeFile(file, '{broken');
    const access = vi.spyOn(runtime.session, 'access').mockImplementation(denied);
    const search = vi.spyOn(runtime.web, 'search').mockImplementation(denied);
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(denied);
    try {
      const { h, context } = await boot({ createRuntime: () => runtime, agentDir: () => dir });
      expect(h.active).toContain('read');
      for (const name of ['web_search', 'code_search']) {
        expect(h.active.includes(name)).toBe(state === 'enabled');
      }
      const web = h.tools.get('web_search')!;
      const code = h.tools.get('code_search')!;
      await writeFile(file, '{broken');
      await expect(web.execute('id', { query: 'q' }, liveSignal(), undefined, context as never)).rejects.toThrow('web_search is disabled');
      await expect(code.execute('id', { search_term: 'q', search_folder_absolute_uri: dir }, liveSignal(), undefined, context as never)).rejects.toThrow('code_search is disabled');
      for (const spy of [search, access, complete, fetcher, network]) expect(spy).not.toHaveBeenCalled();
      await h.commands.get('devin-settings')?.handler('web on', context);
      expect(await runtime.settings.read()).toEqual({ webSearch: true, codeSearch: false });
      expect(h.active).toContain('web_search');
      expect(h.active).not.toContain('code_search');
      expect(h.active).toContain('read');
    } finally {
      network.mockRestore();
      await runtime.dispose();
    }
  });

  it('does not replace another extension tool on a name collision', async () => {
    const { h, context } = await boot({}, [{
      name: 'web_search',
      sourceInfo: { path: 'other-extension', source: 'local', scope: 'user', origin: 'top-level' },
    }]);
    expect(h.tools.has('web_search')).toBe(false);
    expect(h.tools.has('code_search')).toBe(true);
    expect(h.active).toContain('web_search');
    expect(context.ui.notify).toHaveBeenCalledWith(expect.stringContaining('left web_search unchanged'), 'warning');
    expect(String(vi.mocked(context.ui.notify).mock.calls)).not.toContain('override');
  });

  it('rejects raw login and settings arguments without echoing or persisting them', async () => {
    const { h, dir, context } = await boot();
    const secret = 'once-code-SECRET';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.commands.get('devin-login')?.handler(secret, context);
    await h.commands.get('devin-settings')?.handler(secret, context);
    const rendered = JSON.stringify(vi.mocked(context.ui.notify).mock.calls);
    expect(rendered).not.toContain(secret);
    expect(h.appendEntry).not.toHaveBeenCalled();
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(await readFile(join(dir, 'devin-search', 'credentials.json'), 'utf8').catch(() => '')).not.toContain(secret);
    log.mockRestore(); error.mockRestore();
  });

  it('refuses noninteractive login and prints status only through notify', async () => {
    const { h } = await boot();
    const quiet = ctx({ hasUI: false, mode: 'print' });
    const input = vi.fn();
    quiet.ui.input = input;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await h.commands.get('devin-login')?.handler('', quiet);
    expect(input).not.toHaveBeenCalled();
    expect(vi.mocked(quiet.ui.notify).mock.calls.flat().join(' ')).toContain('interactive UI');
    const rpc = ctx({ hasUI: true, mode: 'rpc' });
    await h.commands.get('devin-status')?.handler('', rpc);
    expect(vi.mocked(rpc.ui.notify).mock.calls.flat().join(' ')).toContain('Not logged in');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('uses the settings selector when no arguments are given', async () => {
    const { h, dir } = await boot();
    const context = ctx();
    vi.mocked(context.ui.select).mockResolvedValue('code off');
    await h.commands.get('devin-settings')?.handler('', context);
    expect(context.ui.select).toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(dir, 'devin-search', 'settings.json'), 'utf8'))).toMatchObject({ codeSearch: false, webSearch: true });
    expect(h.active).not.toContain('code_search');
    expect(h.active).toContain('web_search');
  });

  it('aborts login on shutdown and reinitializes after a later session_start', async () => {
    const { h, context } = await boot();
    const pending = ctx();
    let signal: AbortSignal | undefined;
    vi.mocked(pending.ui.input).mockImplementation((_title, _placeholder, opts) => new Promise((_resolve, reject) => {
      signal = opts?.signal;
      opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const login = h.commands.get('devin-login')?.handler('', pending);
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    await h.handlers.get('session_shutdown')?.[0]?.({ type: 'session_shutdown', reason: 'reload' }, context);
    await h.handlers.get('session_shutdown')?.[0]?.({ type: 'session_shutdown', reason: 'quit' }, context);
    await login;
    expect(signal?.aborted).toBe(true);
    await h.commands.get('devin-status')?.handler('', context);
    expect(vi.mocked(context.ui.notify).mock.calls.flat().join(' ')).toContain('not ready');
    await h.handlers.get('session_start')?.[0]?.({ type: 'session_start', reason: 'startup' }, context);
    const again = ctx();
    await h.commands.get('devin-status')?.handler('', again);
    expect(vi.mocked(again.ui.notify).mock.calls.flat().join(' ')).toContain('Not logged in');
    expect(vi.mocked(again.ui.notify).mock.calls.flat().join(' ')).not.toContain('unavailable');
  });

  it('executes code_search with ctx.cwd identity mapping, aborts, and throws provider errors', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), 'export const target = 1;\n');
    const runtime = createSearchRuntime(dir, {
      completion: { async complete() { return '<ANSWER><file path="/codebase/src/a.ts"><range>1-1</range></file></ANSWER>'; } },
      oauth: { fetcher: vi.fn() },
    });
    await runtime.store.write({ version: 1, token: 'devin-session-token$fixture', expiresAt: Date.now() + 60_000, expirySource: 'fallback' });
    const { h, context } = await boot({ createRuntime: () => runtime, agentDir: () => dir });
    const tool = h.tools.get('code_search');
    const executed = await tool?.execute('id', { search_term: 'target', search_folder_absolute_uri: dir }, liveSignal(), undefined, { ...context, cwd: dir } as never);
    expect(executed?.structuredContent).toMatchObject({ status: 'success' });
    expect(JSON.stringify(executed)).toContain('target');
    const aborted = new AbortController();
    aborted.abort();
    await expect(tool?.execute('id', { search_term: 'target', search_folder_absolute_uri: dir }, aborted.signal, undefined, { ...context, cwd: dir } as never)).rejects.toThrow(/cancelled|disabled|failed/i);
    const failing = createSearchRuntime(dir, {
      completion: { async complete() { return 'not-an-answer'; } },
      oauth: { fetcher: vi.fn() },
    });
    await failing.store.write({ version: 1, token: 'devin-session-token$fixture', expiresAt: Date.now() + 60_000, expirySource: 'fallback' });
    const second = await boot({ createRuntime: () => failing, agentDir: () => dir });
    await expect(second.h.tools.get('code_search')?.execute('id', {
      search_term: 'target', search_folder_absolute_uri: dir,
    }, liveSignal(), undefined, { ...second.context, cwd: dir } as never)).rejects.toThrow();
    await runtime.dispose();
    await failing.dispose();
  });
});
