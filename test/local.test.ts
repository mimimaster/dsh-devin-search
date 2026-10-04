import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalWorkspace, LIMITS, command } from '../src/local.js';
import { codeSearch, parseAnswer, parseStructuredAnswer } from '../src/code-search.js';
import type { Completion } from '../src/completion.js';
import { cleanup, deferred, liveSignal, temp } from './helpers.js';
let dir: string; let outside: string;
beforeEach(async () => {
  dir = await temp(); outside = await temp(); await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.ts'), 'export function target() {\n  return 42;\n}\n');
  await writeFile(join(dir, '.gitignore'), 'ignored.txt\n'); await writeFile(join(dir, 'ignored.txt'), 'ignore me');
  await writeFile(join(dir, '.env'), 'FIXTURE_SECRET=fixture'); await writeFile(join(dir, 'credentials.json'), 'fixture');
  await writeFile(join(dir, 'binary.dat'), Buffer.from([0, 1, 2]));
  await writeFile(join(outside, 'escape.ts'), 'outside fixture'); await symlink(join(outside, 'escape.ts'), join(dir, 'link.ts'));
});
afterEach(async () => { await cleanup(dir); await cleanup(outside); });
const input = () => ({ search_term: 'find target', search_folder_absolute_uri: dir });
const loop = (answers: string[]): Completion => ({ complete: vi.fn(async () => answers.shift()!) });
const marker = (commands: unknown) => `[TOOL_CALLS]restricted_exec[ARGS]${JSON.stringify(commands)}`;
describe('bounded host-local code search', () => {
  it('runs a real temporary multi-turn command loop and returns revalidated real snippets', async () => {
    const completion = loop([
      marker({ command1: { op: 'tree' }, command2: { op: 'rg', pattern: 'target' }, command3: { op: 'glob', pattern: '*a.ts' }, command4: { op: 'ls', path: '/codebase/src' } }),
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 } }),
      '<ANSWER><file path="/codebase/src/a.ts"><range>1-3</range></file></ANSWER>',
    ]);
    const result = await codeSearch(input(), dir, p => resolve(p), completion, liveSignal());
    expect(result.status).toBe('success'); expect(result.files[0]?.path).toBe(join(dir, 'src/a.ts')); expect(result.files[0]?.ranges[0]?.content).toContain('2:   return 42;');
    const calls = vi.mocked(completion.complete).mock.calls;
    expect(calls).toHaveLength(3); const transcript = JSON.stringify(calls);
    expect(transcript).toContain('/codebase/src/a.ts'); expect(transcript).not.toContain(dir); expect(transcript).not.toContain('FIXTURE_SECRET');
    expect(transcript).not.toContain('ignore me'); expect(transcript).not.toContain('outside fixture');
  });
  it('accepts the live separator-free marker and structured ANSWER with real snippet validation', async () => {
    const completion = loop([
      '[TOOL_CALLS]restricted_exec{"command1":{"op":"readfile","path":"/codebase/src/a.ts"}}',
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.status).toBe('success'); expect(result.files[0]?.ranges[0]?.content).toContain('return 42');
    expect(parseStructuredAnswer({ files: [] })).toEqual([]);
    expect(() => parseStructuredAnswer({ files: [{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 401 }] }] })).toThrow('range');
    expect(() => parseStructuredAnswer({ files: [], shell: 'bash' })).toThrow();
    const escaped = loop(['[TOOL_CALLS]ANSWER{"files":[{"path":"/etc/passwd","ranges":[{"start":1,"end":1}]}]}']);
    expect((await codeSearch(input(), dir, p => p, escaped, liveSignal())).status).toBe('error');
  });
  it('reports a guessed missing path back to the model without abandoning other commands', async () => {
    const completion = loop([
      marker({ command1: { op: 'ls', path: '/codebase/missing' }, command2: { op: 'readfile', path: '/codebase/src/a.ts' } }),
      '<ANSWER><file path="/codebase/src/a.ts"><range>1-3</range></file></ANSWER>',
    ]);
    expect((await codeSearch(input(), dir, p => p, completion, liveSignal())).status).toBe('success');
    expect(JSON.stringify(vi.mocked(completion.complete).mock.calls[1])).toContain('Path not found');
  });
  it('rejects absent session cwd, remote mapping, foreign absolute folder and symlink escape folder', async () => {
    const completion = loop(['<ANSWER></ANSWER>']);
    expect((await codeSearch(input(), undefined, p => p, completion, liveSignal())).status).toBe('error');
    expect((await codeSearch(input(), dir, () => undefined, completion, liveSignal())).content).toContain('host-local');
    expect((await codeSearch({ ...input(), search_folder_absolute_uri: outside }, dir, p => p, completion, liveSignal())).status).toBe('error');
    await symlink(outside, join(dir, 'foreign'));
    expect((await codeSearch({ ...input(), search_folder_absolute_uri: join(dir, 'foreign') }, dir, p => p, completion, liveSignal())).status).toBe('error');
    expect(completion.complete).not.toHaveBeenCalled();
  });
  it.each(['/etc/passwd', '/codebase/../escape.ts', '/codebase/link.ts', '/codebase/.env', '/codebase/credentials.json', '/codebase/binary.dat', '/codebase/ignored.txt'])('rejects answer path %s', async path => {
    const result = await codeSearch(input(), dir, p => p, loop([`<ANSWER><file path="${path}"><range>1-1</range></file></ANSWER>`]), liveSignal());
    expect(result.status).toBe('error'); expect(result.files).toEqual([]); expect(result.content).not.toContain('fixture');
  });
  it('ignores nested gitignore and generated folders and refuses non-UTF8/oversized files', async () => {
    await writeFile(join(dir, 'src/.gitignore'), 'ignored.ts\n'); await writeFile(join(dir, 'src/ignored.ts'), 'secret-ish fixture');
    await mkdir(join(dir, 'node_modules')); await writeFile(join(dir, 'node_modules/x.ts'), 'excluded');
    await writeFile(join(dir, 'huge.ts'), Buffer.alloc(LIMITS.fileBytes + 1, 65)); await writeFile(join(dir, 'invalid.txt'), Buffer.from([255, 254]));
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    expect(await workspace.inventory()).not.toContain('src/ignored.ts');
    expect(await workspace.inventory()).not.toContain('node_modules/x.ts');
    await expect(workspace.execute({ op: 'readfile', path: '/codebase/huge.ts' })).rejects.toThrow('512');
    await expect(workspace.execute({ op: 'readfile', path: '/codebase/invalid.txt' })).rejects.toThrow('UTF8');
  });
  it('refuses path identity swap before final snippet and ignores binary grep content', async () => {
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal()); await workspace.inventory();
    expect(await workspace.execute({ op: 'rg', pattern: '\0' })).toBe('');
    const { unlink } = await import('node:fs/promises'); await unlink(join(dir, 'src/a.ts')); await symlink(join(outside, 'escape.ts'), join(dir, 'src/a.ts'));
    await expect(workspace.snippet('/codebase/src/a.ts', 1, 1)).rejects.toThrow('Symlinks');
  });
  it('enforces commands/turns/ranges/pattern/output/file visit budgets', async () => {
    expect(() => command({ op: 'bash', path: '/codebase' })).toThrow(); expect(() => command({ op: 'rg', pattern: 'x'.repeat(257) })).toThrow('budget');
    expect((await codeSearch(input(), dir, p => p, loop([marker({ command1: { op: 'tree' }, command5: { op: 'tree' } })]), liveSignal())).content).toContain('command1');
    const m = marker({ command1: { op: 'tree' } }); expect((await codeSearch(input(), dir, p => p, loop([m, m, m, m]), liveSignal())).status).toBe('error');
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    await expect(workspace.snippet('/codebase/src/a.ts', 1, 999)).rejects.toThrow('400');
    await expect(workspace.snippet('/codebase/src/a.ts', 1, 20)).rejects.toThrow('length');
    for (let i = 0; i < LIMITS.filesVisited + 1; i++) await writeFile(join(dir, `f${i}.txt`), 'x');
    await expect((await LocalWorkspace.create(dir, dir, p => p, liveSignal())).inventory()).rejects.toThrow('visit');
  });
  it('literal rg handles hostile regex-like input without regex execution and caps result bytes', async () => {
    await writeFile(join(dir, 'big.txt'), ('(a+)+$ ' + 'a'.repeat(3000) + '\n').repeat(100));
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    const text = await workspace.execute({ op: 'rg', pattern: '(a+)+$' }); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LIMITS.stepBytes);
    for (let i = 0; i < 7; i++) await workspace.execute({ op: 'rg', pattern: '(a+)+$' });
    await expect(workspace.execute({ op: 'rg', pattern: '(a+)+$' })).rejects.toThrow('Total');
  });
  it('preabort, cancellation and global cross-agent overlap guard', async () => {
    const blocked = deferred<string>(); const entered = deferred();
    const completion: Completion = { async complete(_s, _m, _t, signal) { entered.resolve(); return new Promise<string>(resolve => { signal.addEventListener('abort', () => resolve('<ANSWER></ANSWER>'), { once: true }); void blocked.promise.then(resolve); }); } };
    const controller = new AbortController(); const active = codeSearch(input(), dir, p => p, completion, controller.signal); await entered.promise;
    expect((await codeSearch(input(), dir, p => p, completion, liveSignal())).content).toContain('busy'); controller.abort();
    expect((await active).content).toContain('cancelled');
    expect((await codeSearch(input(), dir, p => p, completion, controller.signal)).content).toContain('cancelled');
  });
  it('strict XML rejects arbitrary content, entities and excessive files', () => {
    expect(() => parseAnswer('raw text')).toThrow(); expect(() => parseAnswer('<ANSWER><file path="/codebase/a&amp;b"><range>1-1</range></file></ANSWER>')).toThrow('entities');
    expect(() => parseAnswer(`<ANSWER>${Array.from({ length: 9 }, (_, i) => `<file path="/codebase/${i}"><range>1-1</range></file>`).join('')}</ANSWER>`)).toThrow('eight');
  });
});
