import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import Schema from '@deepseek-ai/schemastery';

export interface Config { webSearch?: boolean; codeSearch?: boolean }
export const Config = Schema.object({
  webSearch: Schema.boolean().default(true).description('网页搜索（web_search）').volatile(),
  codeSearch: Schema.boolean().default(true).description('代码搜索（code_search）').volatile(),
});
export type LiveConfig = ReturnType<typeof Config>;
export function enabled(value: boolean | { get(): boolean } | undefined): boolean {
  return (typeof value === 'object' ? value.get() : value) !== false;
}

declare module '@deepseek-ai/cordis' {
  interface Events { 'app-boot/config-reload'(): void }
}

/** Scope masks control model visibility; the global guard covers agentless/direct dispatch. */
export function webSearchSwitch(ctx: Context, isEnabled: () => boolean): () => void {
  const masks = new Map<Agent, () => void>();
  ctx.tools.guard(exec => exec.name === 'web_search' && !isEnabled() ? 'web_search is disabled in Devin search settings.' : undefined);
  const sync = () => {
    if (isEnabled()) {
      const previous = [...masks.values()]; masks.clear();
      for (const dispose of previous) dispose();
      return;
    }
    if (!ctx.tools.get('web_search')) return; // Built-in tool-web can load later.
    for (const agent of ctx.agents.list()) {
      if (masks.has(agent)) continue;
      masks.set(agent, () => {}); // restrict emits tools/change synchronously.
      try { masks.set(agent, agent.ctx.tools.restrict({ deny: ['web_search'] })); }
      catch (error) { masks.delete(agent); throw error; }
    }
  };
  ctx.on('agent/created', () => { sync(); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { const dispose = masks.get(agent); masks.delete(agent); dispose?.(); });
  ctx.on('tools/change', sync);
  ctx.effect(() => () => { const previous = [...masks.values()]; masks.clear(); for (const dispose of previous) dispose(); });
  sync();
  return sync;
}
