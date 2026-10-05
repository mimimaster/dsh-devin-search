import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type JsonValue } from '@earendil-works/pi-ai';
import { codeSearch } from '../../../src/code-search.js';
import { fail, safeError } from '../../../src/safety.js';
import { createSearchRuntime, type SearchRuntime } from './runtime.js';
import type { SearchSettings } from './settings.js';

export const WEB_TOOL = 'web_search';
export const CODE_TOOL = 'code_search';
const LOGIN_USAGE = 'Use /devin-login or /devin-login local. Do not paste a code into the command.';
const SETTINGS_USAGE = 'Usage: /devin-settings web|code on|off';
const NOT_READY = 'Devin search is not ready.';
const LOGIN_UI = 'Devin login requires an interactive UI.';
const DISABLED = {
  web_search: 'web_search is disabled in Devin search settings.',
  code_search: 'code_search is disabled in Devin search settings.',
} as const;

const CLOUD_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WebParams = Type.Object({
  query: Type.String({ description: 'Search query.', maxLength: 8192 }),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: 'Maximum sources, 1 to 10.' })),
});
const CodeParams = Type.Object({
  search_term: Type.String({ description: 'What code to find.', maxLength: 8192 }),
  search_folder_absolute_uri: Type.String({ description: 'Absolute local folder contained in the session cwd.' }),
});
const WebOutput = Type.Object({
  truncated: Type.Boolean(),
  content: Type.String(),
  sources: Type.Array(Type.Object({
    url: Type.String(),
    title: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
  })),
});
const CodeOutput = Type.Object({
  status: Type.Union([Type.Literal('success'), Type.Literal('error')]),
  content: Type.String(),
  files: Type.Array(Type.Object({
    path: Type.String(),
    ranges: Type.Array(Type.Object({
      start: Type.Integer(),
      end: Type.Integer(),
      content: Type.String(),
    })),
  })),
});

export interface ExtensionDeps {
  /** Defaults to the host `getAgentDir` export. Tests inject a temp directory. */
  agentDir?: () => string;
  createRuntime?: (agentDir: string) => SearchRuntime;
}

interface ToolListing {
  name: string;
  sourcePath?: string;
}

/**
 * Native pi CLI extension. The default export is the factory.
 * No sockets, timers, or credential reads run until session_start.
 */
export function install(pi: ExtensionAPI, deps: ExtensionDeps = {}): void {
  let runtime: SearchRuntime | undefined;
  let disposed = true;
  let ourSource: string | undefined;
  const owned = new Set<string>();
  let loginAbort: AbortController | undefined;

  const agentDir = () => deps.agentDir?.() ?? getAgentDir();
  const makeRuntime = () => deps.createRuntime?.(agentDir()) ?? createSearchRuntime(agentDir());

  const shutdown = async (): Promise<void> => {
    loginAbort?.abort();
    loginAbort = undefined;
    const current = runtime;
    runtime = undefined;
    disposed = true;
    if (current) await current.dispose();
  };

  pi.on('session_shutdown', async () => { await shutdown(); });
  pi.on('session_start', async (_event, ctx) => {
    if (runtime && !disposed) await shutdown();
    runtime = makeRuntime();
    disposed = false;
    const settings = await runtime.settings.read();
    registerTools(pi, ctx, () => runtime, settings, owned, source => { ourSource = source; }, () => ourSource);
    publish(ctx, await runtime.session.status());
  });

  pi.registerCommand('devin-login', {
    description: 'Start Devin PKCE login. Optional local uses a same-machine callback. Do not paste a code here.',
    handler: async (args, ctx) => { await loginCommand(args, ctx); },
  });
  pi.registerCommand('devin-status', {
    description: 'Show Devin login state without credentials.',
    handler: async (_args, ctx) => { publish(ctx, await safeStatus()); },
  });
  pi.registerCommand('devin-logout', {
    description: 'Cancel login and delete the stored Devin session.',
    handler: async (_args, ctx) => {
      if (!runtime || disposed) { publish(ctx, NOT_READY); return; }
      try { await runtime.session.logout(); publish(ctx, await runtime.session.status()); }
      catch (error) { publish(ctx, safeError(error), 'error'); }
    },
  });
  pi.registerCommand('devin-cancel', {
    description: 'Cancel pending Devin authorization.',
    handler: async (_args, ctx) => {
      loginAbort?.abort();
      runtime?.session.cancel();
      publish(ctx, runtime && !disposed ? 'Login cancelled.' : NOT_READY);
    },
  });
  pi.registerCommand('devin-settings', {
    description: 'Turn web or code search on or off. No arguments opens a selector.',
    handler: async (args, ctx) => { await settingsCommand(args, ctx); },
  });

  async function loginCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const trimmed = args.trim();
    if (trimmed && trimmed !== 'local') {
      publish(ctx, LOGIN_USAGE, 'error');
      return;
    }
    if (!ctx.hasUI || ctx.mode === 'print' || ctx.mode === 'json') {
      publish(ctx, LOGIN_UI, 'error');
      return;
    }
    if (!runtime || disposed) { publish(ctx, NOT_READY, 'error'); return; }
    const controller = new AbortController();
    loginAbort = controller;
    const mode = trimmed === 'local' ? 'loopback' : 'code';
    try {
      const text = await runtime.session.login({
        hasUI: true,
        notify: url => { ctx.ui.notify(url, 'info'); },
        prompt: async signal => {
          const value = await ctx.ui.input(
            'Devin authorization code',
            'Paste the code. This input is visible, not masked.',
            { signal, timeout: 300_000 },
          );
          if (!value) return fail('cancelled', 'Devin operation cancelled or timed out.');
          return value;
        },
      }, controller.signal, mode);
      publish(ctx, text);
    } catch (error) {
      publish(ctx, safeError(error), 'error');
    } finally {
      if (loginAbort === controller) loginAbort = undefined;
    }
  }

  async function settingsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!runtime || disposed) { publish(ctx, NOT_READY, 'error'); return; }
    const trimmed = args.trim();
    let choice = trimmed;
    if (!choice) {
      if (!ctx.hasUI) { publish(ctx, SETTINGS_USAGE, 'warning'); return; }
      const selected = await ctx.ui.select('Devin search settings', ['web on', 'web off', 'code on', 'code off']);
      if (!selected) return;
      choice = selected;
    }
    const match = /^(web|code)\s+(on|off)$/.exec(choice);
    if (!match) { publish(ctx, SETTINGS_USAGE, 'warning'); return; }
    const enabled = match[2] === 'on';
    const patch = match[1] === 'web' ? { webSearch: enabled } : { codeSearch: enabled };
    const settings = await runtime.settings.update(patch);
    syncExposure(pi, settings, owned);
    publish(ctx, settingsText(settings));
  }

  async function safeStatus(): Promise<string> {
    if (!runtime || disposed) return NOT_READY;
    try { return await runtime.session.status(); }
    catch (error) { return safeError(error); }
  }
}

function publish(ctx: ExtensionContext, text: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  ctx.ui.notify(text, type);
  ctx.ui.setStatus('devin-search', text);
}

function settingsText(settings: SearchSettings): string {
  return `Devin search: web ${settings.webSearch ? 'on' : 'off'}, code ${settings.codeSearch ? 'on' : 'off'}.`;
}

function listedTools(pi: ExtensionAPI): ToolListing[] | undefined {
  try {
    return pi.getAllTools().map(tool => ({ name: tool.name, sourcePath: tool.sourceInfo?.path }));
  } catch {
    return undefined;
  }
}

function registerTools(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  current: () => SearchRuntime | undefined,
  settings: SearchSettings,
  owned: Set<string>,
  rememberSource: (path: string) => void,
  source: () => string | undefined,
): void {
  const existing = listedTools(pi);
  if (!existing) {
    publish(ctx, 'Devin search could not list tools, so it did not register web_search or code_search.', 'warning');
    return;
  }
  const skipped: string[] = [];
  for (const name of [WEB_TOOL, CODE_TOOL] as const) {
    const found = existing.find(tool => tool.name === name);
    const ours = owned.has(name) || (!!found && !!source() && found.sourcePath === source());
    if (found && !ours) { skipped.push(name); continue; }
    pi.registerTool((name === WEB_TOOL ? webTool(current) : codeTool(current)) as ToolDefinition);
    owned.add(name);
  }
  const after = listedTools(pi);
  const ownedInfo = after?.find(tool => owned.has(tool.name) && tool.sourcePath);
  if (ownedInfo?.sourcePath) rememberSource(ownedInfo.sourcePath);
  if (skipped.length) {
    publish(ctx, `Devin search left ${skipped.join(' and ')} unchanged; another tool already uses that name.`, 'warning');
  }
  syncExposure(pi, settings, owned);
}

function syncExposure(pi: ExtensionAPI, settings: SearchSettings, owned: Set<string>): void {
  let active: string[];
  try { active = pi.getActiveTools(); }
  catch { return; }
  const next = new Set(active);
  if (owned.has(WEB_TOOL)) {
    if (settings.webSearch) next.add(WEB_TOOL); else next.delete(WEB_TOOL);
  }
  if (owned.has(CODE_TOOL)) {
    if (settings.codeSearch) next.add(CODE_TOOL); else next.delete(CODE_TOOL);
  }
  pi.setActiveTools([...next]);
}

function requireRuntime(current: () => SearchRuntime | undefined): SearchRuntime {
  const runtime = current();
  if (!runtime) throw new Error(NOT_READY);
  return runtime;
}

function webTool(current: () => SearchRuntime | undefined): ToolDefinition<typeof WebParams> {
  return {
    name: WEB_TOOL,
    label: 'Devin web search',
    description: 'Read-only Devin/Windsurf web search. The query is sent to the Devin cloud. Requires /devin-login.',
    promptSnippet: 'Search the web with web_search',
    promptGuidelines: ['Use web_search for current public web results. It is read-only and reaches the Devin cloud.'],
    parameters: WebParams,
    outputSchema: WebOutput,
    executionMode: 'sequential',
    annotations: CLOUD_ANNOTATIONS,
    async execute(_id, params, signal) {
      const runtime = requireRuntime(current);
      const settings = await runtime.settings.read();
      if (!settings.webSearch) throw new Error(DISABLED.web_search);
      if (signal?.aborted) return fail('cancelled', 'Devin operation cancelled or timed out.');
      try {
        const result = await runtime.web.search({ query: params.query, maxResults: params.maxResults }, signal);
        const content = result.sources.map(source => `${source.title ?? source.url}\n${source.url}\n${source.snippet ?? ''}`).join('\n\n')
          || 'No web results.';
        const structured = {
          truncated: result.truncated,
          content,
          sources: result.sources.map(source => {
            const row: Record<string, string> = { url: source.url };
            if (source.title) row.title = source.title;
            if (source.snippet) row.snippet = source.snippet;
            return row;
          }),
        };
        return { content: [{ type: 'text', text: content }], details: structured, structuredContent: structured as JsonValue };
      } catch (error) {
        throw new Error(safeError(error));
      }
    },
  };
}

function codeTool(current: () => SearchRuntime | undefined): ToolDefinition<typeof CodeParams> {
  return {
    name: CODE_TOOL,
    label: 'Devin code search',
    description: 'Cloud-assisted read-only code search in the local session workspace. Selected code is sent to the Devin/Windsurf cloud. Never remote workspaces.',
    promptSnippet: 'Search local code with code_search',
    promptGuidelines: ['Use code_search for read-only lookup in the local session cwd. It sends selected code to the Devin cloud.'],
    parameters: CodeParams,
    outputSchema: CodeOutput,
    executionMode: 'sequential',
    annotations: CLOUD_ANNOTATIONS,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const runtime = requireRuntime(current);
      const settings = await runtime.settings.read();
      if (!settings.codeSearch) throw new Error(DISABLED.code_search);
      if (signal?.aborted) return fail('cancelled', 'Devin operation cancelled or timed out.');
      let result;
      try {
        const access = await runtime.session.access(signal);
        result = await codeSearch(
          { search_term: params.search_term, search_folder_absolute_uri: params.search_folder_absolute_uri },
          ctx.cwd,
          path => path,
          runtime.completion,
          access.signal,
        );
      } catch (error) {
        throw new Error(safeError(error));
      }
      if (result.status === 'error') throw new Error(result.content);
      const structured = JSON.parse(JSON.stringify(result)) as JsonValue;
      return {
        content: [{ type: 'text', text: result.content }],
        details: result,
        structuredContent: structured,
      };
    },
  };
}

export default function devinSearchExtension(pi: ExtensionAPI): void {
  install(pi);
}
