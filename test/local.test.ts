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
    const mixed = loop(['[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]},{"path":"/codebase/src/missing.js","ranges":[{"start":1,"end":20}]}]}']);
    const kept = await codeSearch(input(), dir, p => p, mixed, liveSignal());
    expect(kept.status).toBe('success');
    expect(kept.files.map(f => f.path)).toEqual([join(dir, 'src/a.ts')]);
    expect(kept.content).toContain('were omitted');
    expect(kept.content).not.toContain('Devin operation failed');
  });
  it('reports a guessed missing path back to the model without abandoning other commands', async () => {
    const completion = loop([
      marker({ command1: { op: 'ls', path: '/codebase/missing' }, command2: { op: 'readfile', path: '/codebase/src/a.ts' } }),
      '<ANSWER><file path="/codebase/src/a.ts"><range>1-3</range></file></ANSWER>',
    ]);
    expect((await codeSearch(input(), dir, p => p, completion, liveSignal())).status).toBe('success');
    expect(JSON.stringify(vi.mocked(completion.complete).mock.calls[1])).toContain('Path not found');
  });
  it('searches a targeted path and validates snippets without enumerating a large unrelated subtree', async () => {
    await mkdir(join(dir, 'unrelated'));
    await Promise.all(Array.from({ length: LIMITS.filesVisited + 20 }, (_, i) => writeFile(join(dir, `unrelated/f${i}.ts`), 'unrelated')));
    const completion = loop([
      marker({ command1: { op: 'ls' } }),
      marker({ command1: { op: 'rg', path: '/codebase/src', pattern: 'target' } }),
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 } }),
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('return 42');
    const transcript = JSON.stringify(vi.mocked(completion.complete).mock.calls);
    expect(transcript).toContain('/codebase/unrelated/');
    expect(transcript).not.toContain('unrelated/f0.ts');
  });
  it('reports bounded broad scans as partial and still permits a subsequent exact file read', async () => {
    await mkdir(join(dir, 'many'));
    await Promise.all(Array.from({ length: LIMITS.filesVisited + 20 }, (_, i) => writeFile(join(dir, `many/f${i}.ts`), 'ordinary file')));
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    const partial = await workspace.execute({ op: 'rg', path: '/codebase/many', pattern: 'missing' });
    expect(partial).toContain('[PARTIAL]');
    expect(partial).toContain('not proof');
    expect(await workspace.execute({ op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 })).toContain('return 42');
    expect((await workspace.snippet('/codebase/src/a.ts', 1, 3)).content).toContain('return 42');
  });
  it('does not describe a truncated empty scan as a verified whole-workspace no-match', async () => {
    await mkdir(join(dir, 'many'));
    await Promise.all(Array.from({ length: LIMITS.filesVisited + 1 }, (_, i) => writeFile(join(dir, `many/f${i}.ts`), 'ordinary file')));
    const completion = loop([marker({ command1: { op: 'rg', path: '/codebase/many', pattern: 'missing' } }), '[TOOL_CALLS]ANSWER{"files":[]}']);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.content).toContain('Search was partial');
    expect(result.content).not.toBe('No relevant files found.');
  });
  it('counts repeated keyword scans once while retaining a cumulative distinct-file limit', async () => {
    const batches = LIMITS.totalFilesVisited / LIMITS.filesVisited;
    for (let batch = 0; batch <= batches; batch++) {
      await mkdir(join(dir, `many${batch}`));
      await Promise.all(Array.from({ length: LIMITS.filesVisited + 1 }, (_, i) => writeFile(join(dir, `many${batch}/f${i}.ts`), 'ordinary file')));
    }
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    for (let i = 0; i < batches; i++) {
      expect(await workspace.execute({ op: 'glob', path: `/codebase/many${i}`, pattern: 'missing' })).toContain('[PARTIAL]');
      expect(await workspace.execute({ op: 'glob', path: `/codebase/many${i}`, pattern: 'missing' })).toContain('[PARTIAL]');
    }
    await expect(workspace.execute({ op: 'glob', path: `/codebase/many${batches}`, pattern: 'missing' })).rejects.toThrow('Total distinct file visit');
  });
  it('reuses unchanged bytes so repeated scans extend coverage without exhausting the physical read budget', async () => {
    await mkdir(join(dir, 'bulk'));
    const chunk = Buffer.alloc(400 * 1024, 65);
    await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(dir, 'bulk', `f${i}.txt`), chunk)));
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    expect(await workspace.execute({ op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 1 })).toContain('export function target');
    for (let i = 0; i < 6; i++) expect(await workspace.execute({ op: 'rg', path: '/codebase/bulk', pattern: 'NEVER' })).toContain('[PARTIAL]');
    expect((await workspace.snippet('/codebase/src/a.ts', 1, 1)).content).toContain('export function target');
  });
  it('lets the model recover from readfile on a directory without weakening file validation', async () => {
    const completion = loop([
      marker({ command1: { op: 'readfile', path: '/codebase/src' }, command2: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 } }),
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    expect((await codeSearch(input(), dir, p => p, completion, liveSignal())).status).toBe('success');
    expect(JSON.stringify(vi.mocked(completion.complete).mock.calls)).toContain('Path is a directory');
  });
  it('admits at most four commands from a live overfilled batch, reports skipped commands, and continues', async () => {
    const completion = loop([
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 }, command2: { op: 'ls' }, command3: { op: 'ls' }, command4: { op: 'ls' }, command5: { op: 'readfile', path: '/codebase/.env' }, command6: { op: 'bash' }, command7: { op: 'ls' }, command8: { op: 'ls' } }),
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.status).toBe('success');
    const transcript = JSON.stringify(vi.mocked(completion.complete).mock.calls);
    expect(transcript).toContain('Commands beyond command4 were not executed');
    expect(transcript).not.toContain('FIXTURE_SECRET');
  });
  it('rejects an invalid admitted batch before executing its first valid command', async () => {
    const completion = loop([
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts' }, command2: { op: 'bash' } }),
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.status).toBe('success');
    const correction = JSON.stringify(vi.mocked(completion.complete).mock.calls[1]);
    expect(correction).toContain('Invalid restricted_exec');
    expect(correction).toContain('No commands were executed');
    expect(correction).not.toContain('return 42');
  });
  it('refuses unsupported cloud tools immediately rather than running them in a repair turn', async () => {
    const completion = loop(['[TOOL_CALLS]bash{"command":"cat /etc/passwd"}']);
    expect((await codeSearch(input(), dir, p => p, completion, liveSignal())).content).toContain('unsupported tool');
    expect(completion.complete).toHaveBeenCalledTimes(1);
  });
  it('applies ancestor ignore rules on direct reads without needing a full inventory', async () => {
    await mkdir(join(dir, 'src/hidden'));
    await writeFile(join(dir, 'src/.gitignore'), 'hidden/\n');
    await writeFile(join(dir, 'src/hidden/.gitignore'), '!a.ts\n');
    await writeFile(join(dir, 'src/hidden/a.ts'), 'must not leave the host');
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    await expect(workspace.execute({ op: 'readfile', path: '/codebase/src/hidden/a.ts' })).rejects.toThrow('Ignored');
    await expect(workspace.snippet('/codebase/src/hidden/a.ts', 1, 1)).rejects.toThrow('Ignored');
  });
  it('allows more than three discovery turns and repairs one refused final command without executing it', async () => {
    const discover = marker({ command1: { op: 'ls' } });
    const completion = loop([
      discover, discover, discover, discover, discover,
      marker({ command1: { op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 3 } }),
      marker({ command1: { op: 'readfile', path: '/codebase/.env' } }),
      '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":3}]}]}',
    ]);
    const result = await codeSearch(input(), dir, p => p, completion, liveSignal());
    expect(result.status).toBe('success');
    expect(completion.complete).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(vi.mocked(completion.complete).mock.calls)).toContain('No commands were executed');
    expect(JSON.stringify(vi.mocked(completion.complete).mock.calls)).not.toContain('FIXTURE_SECRET');
  });
  it('denies stored and temp credential files under a custom data directory inside the workspace', async () => {
    const data = join(dir, 'custom-agent', 'devin-search');
    await mkdir(data, { recursive: true });
    await writeFile(join(data, 'credentials.json'), 'STORED_SECRET=nope');
    await writeFile(join(data, 'credential-abcdef12.tmp'), 'TEMP_SECRET=nope');
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    for (const path of [
      '/codebase/custom-agent/devin-search/credentials.json',
      '/codebase/custom-agent/devin-search/credential-abcdef12.tmp',
    ]) {
      await expect(workspace.execute({ op: 'readfile', path })).rejects.toThrow('Sensitive or generated');
      await expect(workspace.snippet(path, 1, 1)).rejects.toThrow('Sensitive or generated');
      await expect(workspace.execute({ op: 'rg', path, pattern: 'SECRET' })).rejects.toThrow('Sensitive or generated');
    }
    const listing = await workspace.execute({ op: 'ls', path: '/codebase/custom-agent/devin-search' });
    expect(listing).not.toContain('credentials.json');
    expect(listing).not.toContain('credential-');
    expect(listing).not.toContain('STORED_SECRET');
    expect(listing).not.toContain('TEMP_SECRET');
    expect(await workspace.execute({ op: 'rg', pattern: 'STORED_SECRET' })).not.toContain('STORED_SECRET');
    expect(await workspace.execute({ op: 'rg', pattern: 'TEMP_SECRET' })).not.toContain('TEMP_SECRET');
    const files = await workspace.inventory();
    expect(files.some(file => file.includes('credentials.json') || file.includes('credential-'))).toBe(false);
  });
  it('rejects direct and nested .pi traversal and reads while allowing sibling code', async () => {
    await mkdir(join(dir, '.pi'));
    await writeFile(join(dir, '.pi', 'secret.ts'), 'direct pi secret\n');
    await writeFile(join(dir, 'sibling.ts'), 'export const sibling = 1;\n');
    await mkdir(join(dir, 'src', '.pi'));
    await writeFile(join(dir, 'src', '.pi', 'nested.ts'), 'nested pi secret\n');
    const workspace = await LocalWorkspace.create(dir, dir, p => p, liveSignal());
    await expect(LocalWorkspace.create(dir, join(dir, '.pi'), p => p, liveSignal())).rejects.toThrow('workspace');
    await expect(LocalWorkspace.create(dir, join(dir, 'src', '.pi'), p => p, liveSignal())).rejects.toThrow('workspace');
    for (const path of ['/codebase/.pi', '/codebase/.pi/secret.ts', '/codebase/src/.pi', '/codebase/src/.pi/nested.ts']) {
      await expect(workspace.execute({ op: 'readfile', path })).rejects.toThrow('Sensitive or generated');
      await expect(workspace.snippet(path, 1, 1)).rejects.toThrow('Sensitive or generated');
      await expect(workspace.execute({ op: 'ls', path })).rejects.toThrow('Sensitive or generated');
      await expect(workspace.execute({ op: 'tree', path })).rejects.toThrow('Sensitive or generated');
      await expect(workspace.execute({ op: 'rg', path, pattern: 'secret' })).rejects.toThrow('Sensitive or generated');
    }
    const root = await workspace.execute({ op: 'ls' });
    expect(root).toContain('/codebase/sibling.ts');
    expect(root).toContain('/codebase/src/');
    expect(root).not.toContain('.pi');
    const src = await workspace.execute({ op: 'ls', path: '/codebase/src' });
    expect(src).toContain('/codebase/src/a.ts');
    expect(src).not.toContain('.pi');
    expect(await workspace.execute({ op: 'tree' })).not.toContain('.pi');
    expect(await workspace.execute({ op: 'rg', pattern: 'pi secret' })).not.toContain('secret');
    expect(await workspace.execute({ op: 'readfile', path: '/codebase/sibling.ts', start: 1, end: 1 })).toContain('sibling');
    expect(await workspace.execute({ op: 'readfile', path: '/codebase/src/a.ts', start: 1, end: 1 })).toContain('export function target');
    const files = await workspace.inventory();
    expect(files).toContain('sibling.ts');
    expect(files).toContain('src/a.ts');
    expect(files.some(file => file.split('/').includes('.pi'))).toBe(false);
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
    expect((await codeSearch(input(), dir, p => p, loop([marker({ command1: { op: 'tree' }, shell: { op: 'tree' } })]), liveSignal())).content).toContain('unknown fields');
    const m = marker({ command1: { op: 'tree' } });
    const exhausted = loop(Array(8).fill(m));
    expect((await codeSearch(input(), dir, p => p, exhausted, liveSignal())).content).toContain('exhausted its command budget');
    expect(exhausted.complete).toHaveBeenCalledTimes(8);
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
