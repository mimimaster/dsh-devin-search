import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-fs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Sessions, KEY } from './session.js';
import { WindsurfCompletion, type Completion } from './completion.js';
import { webProvider } from './web.js';
import { codeSearch } from './code-search.js';
import { safeError } from './safety.js';
import type { OAuthOptions } from './oauth.js';
import { mountLoginApi } from './login-api.js';
import { Config, enabled, webSearchSwitch, type LiveConfig } from './settings.js';
export { Config };
export const name = 'devin-search';
export const inject = ['authorization', 'credentials', 'commands', 'web', 'tools', 'fs', 'agents'];
export interface FixtureOptions {
  oauth?: OAuthOptions; web?: Parameters<typeof webProvider>[1];
  completion?: Completion; cloud?: ConstructorParameters<typeof WindsurfCompletion>[1];
}
/** Dependency seam for OFFLINE tests. The production plugin accepts no endpoint/secret config. */
export async function createRuntime(ctx: Context, options: FixtureOptions = {}, config: Config | LiveConfig = {}): Promise<Sessions> {
  const sessions = new Sessions(ctx, options.oauth);
  const cloud = new WindsurfCompletion(sessions, options.cloud);
  ctx.effect(() => () => { sessions.dispose(); cloud.invalidate(); });
  ctx.on('credentials/record-updated', key => { if (key === KEY) { sessions.invalidate(); cloud.invalidate(); void sessions.reload().catch(() => {}); } });
  await sessions.reload();
  ctx.authorization.registerFlow({ key: KEY, label: 'Devin search', methods: [{ id: 'oauth', label: 'Local browser callback (PKCE)' }, { id: 'code', label: 'Paste authorization code (remote-safe PKCE)' }], run: session => sessions.run(session) });
  mountLoginApi(ctx, sessions);
  const commands = {
    'devin-login': { description: 'Start Devin code login; use local for a same-machine browser callback.', run: (signal: AbortSignal, input = '') => {
      const mode = input.trim();
      if (mode && mode !== 'local') throw new Error('Use /devin-login or /devin-login local. Never paste a code into chat.');
      return sessions.login(signal, mode === 'local' ? 'loopback' : 'code');
    } },
    'devin-status': { description: 'Inspect Devin login state without exposing credentials.', run: () => sessions.status() },
    'devin-logout': { description: 'Cancel login/search and delete the stored Devin session.', run: async () => { await sessions.logout(); return 'Logged out; stored Devin session cleared.'; } },
    'devin-cancel': { description: 'Cancel pending Devin authorization.', run: async () => { sessions.cancel(); return 'Login cancelled.'; } },
  };
  for (const [commandName, command] of Object.entries(commands)) ctx.commands.register({ name: commandName, description: command.description, recordInput: false, handler: async invocation => {
    try { return { kind: 'success', text: await command.run(invocation.signal, invocation.rawInput) }; }
    catch (error) { return { kind: 'error', text: safeError(error) }; }
  } });
  const provider = webProvider(sessions, options.web);
  ctx.web.registerSearchProvider({ ...provider, available: () => enabled(config.webSearch) && provider.available(), search: (args, signal) => {
    if (!enabled(config.webSearch)) throw new Error('web_search is disabled in Devin search settings.');
    return provider.search(args, signal);
  } });
  const syncWeb = webSearchSwitch(ctx, () => enabled(config.webSearch));
  const codeTool = defineTool({
    name: 'code_search', description: 'Cloud-assisted read-only code search in the local session workspace. Selected code is sent to Devin/Windsurf cloud. Never remote workspaces.',
    parameters: { search_term: { type: 'string', required: true, description: 'What code to find.' }, search_folder_absolute_uri: { type: 'string', required: true, description: 'Absolute local folder contained in the session cwd.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['success', 'error'], required: true },
        files: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          path: { type: 'string', required: true }, ranges: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { start: { type: 'integer', required: true }, end: { type: 'integer', required: true }, content: { type: 'string', required: true } } } },
        } } }, content: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      if (Object.keys(args).some(k => !['search_term', 'search_folder_absolute_uri'].includes(k))) throw new Error('Only search_term and search_folder_absolute_uri are accepted.');
      let result;
      try {
        const access = await sessions.access(exec.signal);
        result = await codeSearch(args, exec.agent?.session.header.cwd, path => ctx.fs.processPathFromHostPath(path), options.completion ?? cloud, access.signal);
      } catch (error) { throw new Error(safeError(error)); }
      // DSH marks a resolved value as successful even if it says status:error.
      // Throw so its native tool row/log correctly shows a failed execution.
      if (result.status === 'error') throw new Error(result.content);
      return result;
    },
  });
  let unregisterCode: (() => void) | undefined;
  const sync = () => {
    syncWeb();
    if (enabled(config.codeSearch) && !unregisterCode) unregisterCode = ctx.tools.register(codeTool);
    else if (!enabled(config.codeSearch) && unregisterCode) { const dispose = unregisterCode; unregisterCode = undefined; dispose(); }
  };
  ctx.on('app-boot/config-reload', sync);
  sync();
  return sessions;
}
export async function apply(ctx: Context, config: LiveConfig = Config({})): Promise<void> { await createRuntime(ctx, {}, config); }
