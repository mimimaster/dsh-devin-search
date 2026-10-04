import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit';
import { Config } from '../src/settings.js';
import { KEY } from '../src/session.js';
import { cleanup, harness, liveSignal, store, temp } from './helpers.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const builtin = (name: string) => defineTool({ name, description: 'Native fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] }, execute: async () => name });
async function setup(webSearch: boolean, codeSearch: boolean) {
  const dir = await temp(); cleanups.push(() => cleanup(dir));
  const config = Config({ webSearch, codeSearch });
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{"results":[{"url":"https://example.test","title":"fixture"}]}'));
  const h = await harness(dir, { web: { fetcher }, completion: { complete: async () => '<ANSWER></ANSWER>' } }, config);
  cleanups.push(() => h.close()); await store(h);
  h.ctx.tools.register(builtin('web_search')); h.ctx.tools.register(builtin('web_fetch'));
  return { h, config, fetcher };
}
const names = (h: Awaited<ReturnType<typeof harness>>) => h.ctx.tools.schemas(h.agent).map(t => t.name);
describe('desktop search switches', () => {
  it('declares editable native settings fields, not validation-only booleans', () => {
    expect(Config.dict?.webSearch?.meta.volatile).toBe(true);
    expect(Config.dict?.codeSearch?.meta.volatile).toBe(true);
    expect(Config({}).webSearch.get()).toBe(true);
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])('web=%s code=%s are independent', async (web, code) => {
    const { h, fetcher } = await setup(web!, code!);
    expect(names(h).includes('web_search')).toBe(web);
    expect(names(h).includes('code_search')).toBe(code);
    expect(names(h)).toContain('web_fetch');
    expect(h.ctx.authorization.describe(KEY)).toBeDefined();
    expect(h.sessions.available()).toBe(true);
    if (web) expect((await h.ctx.web.search({ query: 'fixture' })).sources).toHaveLength(1);
    else {
      await expect(h.ctx.web.search({ query: 'fixture' })).rejects.toThrow('unavailable');
      const result = await h.ctx.tools.execute({ callId: 'fixture' as never, name: 'web_search', arguments: {}, signal: liveSignal() });
      expect(result.isError).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('applies live changes and restores visibility without logout or restart', async () => {
    const { h, config } = await setup(true, true);
    updateVolatile(config.webSearch, createVolatile(false));
    h.ctx.emit('app-boot/config-reload');
    expect(names(h)).not.toContain('web_search'); expect(names(h)).toContain('code_search');
    updateVolatile(config.codeSearch, createVolatile(false)); h.ctx.emit('app-boot/config-reload');
    expect(names(h)).toEqual(['web_fetch']);
    updateVolatile(config.webSearch, createVolatile(true)); h.ctx.emit('app-boot/config-reload');
    expect(names(h)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
    expect(names(h)).not.toContain('code_search');
    updateVolatile(config.codeSearch, createVolatile(true)); h.ctx.emit('app-boot/config-reload');
    expect(names(h)).toEqual(expect.arrayContaining(['code_search', 'web_search', 'web_fetch']));
    expect(h.sessions.available()).toBe(true);
    expect((await h.ctx.credentials.readRecord(KEY))?.kind).toBe('grant');
    await h.plugin.dispose();
    expect(names(h)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
  });
});
