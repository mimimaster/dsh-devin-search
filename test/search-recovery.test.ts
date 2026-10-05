import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeSearch, parseStructuredAnswer, SEARCH_TURNS, SYSTEM, TOOLS } from '../src/code-search.js';
import { LIMITS, LocalWorkspace, type Command } from '../src/local.js';
import type { Completion } from '../src/completion.js';
import { DevinError } from '../src/safety.js';
import { cleanup, liveSignal, temp } from './helpers.js';
let dir: string; let outside: string;
beforeEach(async () => {
  dir = await temp(); outside = await temp(); await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.ts'), 'export function target() {\n  return 42;\n}\n');
  await writeFile(join(dir, '.gitignore'), 'hidden-note.txt\n');
  await writeFile(join(dir, 'hidden-note.txt'), 'IGNORED_SECRET');
  await writeFile(join(dir, 'subscription-auth-credentials.ts'), 'CREDENTIAL_SECRET=nope');
  await writeFile(join(outside, 'escape.ts'), 'OUTSIDE_SECRET');
  await symlink(join(outside, 'escape.ts'), join(dir, 'link.ts'));
});
afterEach(async () => { await cleanup(dir); await cleanup(outside); });
const input = () => ({ search_term: 'find target', search_folder_absolute_uri: dir });
const marker = (commands: unknown) => `[TOOL_CALLS]restricted_exec[ARGS]${JSON.stringify(commands)}`;
const answer = (start = 1, end = 3) => `[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":${start},"end":${end}}]}]}`;
const run = (completion: Completion, signal = liveSignal()) => codeSearch(input(), dir, p => p, completion, signal);
/** Snapshot messages at call time; the search mutates the same array afterward. */
function loop(answers: string[]): Completion & { prompts: string[] } {
  const prompts: string[] = [];
  const complete = vi.fn(async (_system: string, messages: readonly { role: string; content: string; call?: unknown; callId?: string }[]) => {
    prompts.push(JSON.stringify(messages));
    return answers.shift()!;
  });
  return { complete, prompts };
}
describe('bounded code-search recovery', () => {
  it('states integer windows, 400-line ranges, 4 per file and 16 total without coercing answers', () => {
    expect(SYSTEM).toContain('integers >= 1');
    expect(SYSTEM).toContain('end >= start');
    expect(SYSTEM).toContain('at most 400 lines per range');
    expect(SYSTEM).toContain('at most 4 ranges per file');
    expect(SYSTEM).toContain('16 ranges total');
    expect(TOOLS).toContain('integers >= 1');
    expect(() => parseStructuredAnswer({ files: [{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 401 }] }] })).toThrow('Invalid code search ANSWER range');
    expect(() => parseStructuredAnswer({ files: [{ path: '/codebase/a.ts', ranges: [{ start: 1.5, end: 2 }] }] })).toThrow('range');
    expect(() => parseStructuredAnswer({ files: [{ path: '/codebase/a.ts', ranges: [{ start: '1', end: 2 }] }] })).toThrow('range');
  });
  it('recovers malformed tool JSON into a valid ANSWER without inventing a call or parsing permissively', async () => {
    const completion = loop(['[TOOL_CALLS]restricted_exec{"command1":', answer()]);
    const result = await run(completion);
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('return 42');
    const messages = JSON.parse(completion.prompts[1]!) as { role: string; call?: unknown; callId?: string; content: string }[];
    expect(messages.some(m => m.role === 'user' && m.content.includes('Invalid Devin JSON response') && m.content.includes('No commands were executed'))).toBe(true);
    expect(messages.some(m => m.call || m.callId)).toBe(false);
    expect(completion.prompts[1]).not.toContain('return 42');
  });
  it('recovers an invalid structured range instead of clamping it', async () => {
    const completion = loop([answer(1, 500), answer()]);
    const result = await run(completion);
    expect(result.status).toBe('success');
    expect(result.content).toContain('return 42');
    expect(completion.prompts[1]).toContain('Invalid code search ANSWER range');
    expect(completion.prompts[1]).toContain('No commands were executed');
    expect(completion.prompts[1]).not.toContain('return 42');
  });
  it('rejects a bad line window before any admitted command runs, then accepts a valid batch', async () => {
    const completion = loop([
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 }, command2: { op: 'readfile', path: '/codebase/src/a.ts', start: 0, end: 2 } }),
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 } }),
      answer(),
    ]);
    const result = await run(completion);
    expect(result.status).toBe('success');
    expect(completion.prompts[1]).toContain('Invalid line window');
    expect(completion.prompts[1]).toContain('No commands were executed');
    expect(completion.prompts[1]).not.toContain('return 42');
    expect(completion.prompts[2]).toContain('return 42');
  });
  it('denies a forbidden path inside a batch while the allowed command still runs', async () => {
    const completion = loop([
      marker({
        command1: { op: 'readfile', path: '/codebase/subscription-auth-credentials.ts', start: 1, end: 1 },
        command2: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 },
        command3: { op: 'readfile', path: '/codebase/hidden-note.txt', start: 1, end: 1 },
        command4: { op: 'readfile', path: '/codebase/link.ts', start: 1, end: 1 },
      }),
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 500 } }),
      answer(),
    ]);
    const result = await run(completion);
    expect(result.status).toBe('success');
    expect(result.content).toContain('return 42');
    const all = completion.prompts.join('\n');
    for (const message of ['Sensitive or generated paths are excluded.', 'Ignored paths are excluded.', 'Symlinks are excluded from code_search.', 'Read window exceeds 400 lines.']) expect(all).toContain(message);
    for (const secret of ['CREDENTIAL_SECRET', 'IGNORED_SECRET', 'OUTSIDE_SECRET']) {
      expect(all).not.toContain(secret); expect(result.content).not.toContain(secret);
    }
    expect(completion.prompts[1]).toContain('return 42');
  });
  it('terminates repeated invalid output at the existing turn budget and keeps the validation error', async () => {
    const answers = Array.from({ length: SEARCH_TURNS + 5 }, () => '[TOOL_CALLS]ANSWER{broken');
    const completion = loop(answers);
    const result = await run(completion);
    expect(result.status).toBe('error');
    expect(result.files).toEqual([]);
    expect(result.content).toBe('Invalid Devin JSON response.');
    expect(completion.complete).toHaveBeenCalledTimes(SEARCH_TURNS + 2);
    expect(answers).toHaveLength(3);
  });
  it('keeps cancellation, transport, budgets, escapes and path races fail-closed', async () => {
    const aborted = new AbortController(); aborted.abort();
    expect((await run(loop([answer()]), aborted.signal)).content).toContain('cancelled');
    const transport: Completion = { complete: vi.fn(async () => { throw new DevinError('protocol', 'Partial or trailing Devin stream frame.'); }) };
    expect((await run(transport)).content).toContain('Partial or trailing Devin stream frame.');
    expect(transport.complete).toHaveBeenCalledTimes(1);
    await writeFile(join(dir, 'huge.ts'), Buffer.alloc(LIMITS.fileBytes + 1, 65));
    const huge = loop([marker({ command1: { op: 'readfile', path: '/codebase/huge.ts', start: 1, end: 1 } }), answer()]);
    expect((await run(huge)).content).toContain('512');
    expect(huge.complete).toHaveBeenCalledTimes(1);
    const escape = loop([marker({ command1: { op: 'readfile', path: '/codebase/../escape.ts' }, command2: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 1 } }), answer()]);
    expect((await run(escape)).content).toContain('Only contained');
    expect(escape.complete).toHaveBeenCalledTimes(1);
    const wide = loop([marker({ command1: { op: 'rg', pattern: 'x'.repeat(257) }, command2: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 1 } }), answer()]);
    expect((await run(wide)).content).toContain('budget');
    expect(wide.complete).toHaveBeenCalledTimes(1);
    const original = LocalWorkspace.prototype.execute;
    for (const message of ['File changed identity during read.', 'Workspace path changed or escaped.', 'Total command output budget exceeded.', 'Total distinct file visit budget exceeded.']) {
      const spy = vi.spyOn(LocalWorkspace.prototype, 'execute').mockImplementation(async function (this: LocalWorkspace, cmd: Command) {
        if (cmd.path === '/codebase/src/a.ts') throw new DevinError(message.startsWith('Total') ? 'bounds' : 'path', message);
        return original.call(this, cmd);
      });
      try {
        const completion = loop([marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 1 } }), answer()]);
        const result = await run(completion);
        expect(result.status).toBe('error');
        expect(result.content).toBe(message);
        expect(completion.complete).toHaveBeenCalledTimes(1);
      } finally { spy.mockRestore(); }
    }
  });
});
