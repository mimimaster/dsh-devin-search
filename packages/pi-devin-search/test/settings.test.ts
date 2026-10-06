import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/settings.js';
import { cleanup, tempDir } from './helpers.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), readFile: vi.fn(actual.readFile) };
});
const dirs: string[] = [];
const off = { webSearch: false, codeSearch: false };
afterEach(async () => {
  vi.mocked(lstat).mockReset();
  vi.mocked(readFile).mockReset();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(lstat).mockImplementation(actual.lstat);
  vi.mocked(readFile).mockImplementation(actual.readFile);
  await Promise.all(dirs.splice(0).map(cleanup));
});
async function fixture() {
  const dir = await tempDir();
  dirs.push(dir);
  await mkdir(join(dir, 'devin-search'));
  return { dir, file: join(dir, 'devin-search', 'settings.json'), store: new SettingsStore(dir) };
}

describe('native pi settings fail closed', () => {
  it('uses fresh enabled defaults only for an initially absent file', async () => {
    const { dir, store } = await fixture();
    const first = await store.read();
    expect(first).toEqual({ webSearch: true, codeSearch: true });
    first.webSearch = false;
    expect(await store.read()).toEqual({ webSearch: true, codeSearch: true });
    expect(await new SettingsStore(join(dir, 'absent-agent')).read()).toEqual({ webSearch: true, codeSearch: true });
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])('honors booleans web=%s code=%s and ignores unrelated keys', async (webSearch, codeSearch) => {
    const { file, store } = await fixture();
    await writeFile(file, JSON.stringify({ webSearch, codeSearch, unrelated: 'ignored' }));
    const first = await store.read();
    expect(first).toEqual({ webSearch, codeSearch });
    first.webSearch = !webSearch;
    expect(await store.read()).toEqual({ webSearch, codeSearch });
  });

  it('keeps both searches disabled after persisted settings become malformed', async () => {
    const { dir, file, store } = await fixture();
    await store.update(off);
    expect(await new SettingsStore(dir).read()).toEqual(off);
    await writeFile(file, '{broken');
    const first = await store.read();
    expect(first).toEqual(off);
    first.webSearch = true;
    expect(await new SettingsStore(dir).read()).toEqual(off);
  });

  it.each(['null', 'true', '0', '"text"', '[]', '{}', '{"webSearch":true}', '{"codeSearch":false}',
    '{"webSearch":true,"codeSearch":null}', '{"webSearch":"false","codeSearch":false}',
    '{"webSearch":false,"codeSearch":1}', '{"webSearch":{},"codeSearch":[]}',
  ])('rejects invalid record %s', async raw => {
    const { file, store } = await fixture();
    await writeFile(file, raw);
    expect(await store.read()).toEqual(off);
  });

  it('rejects an oversized file before reading it', async () => {
    const { file, store } = await fixture();
    await writeFile(file, JSON.stringify({ webSearch: true, codeSearch: true }) + ' '.repeat(4096));
    vi.mocked(readFile).mockClear();
    expect(await store.read()).toEqual(off);
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each(['symlink', 'directory'])('rejects a %s without reading it', async kind => {
    const { dir, file, store } = await fixture();
    if (kind === 'directory') await mkdir(file);
    else {
      const target = join(dir, 'fixture.json');
      await writeFile(target, JSON.stringify({ webSearch: true, codeSearch: true }));
      await symlink(target, file);
    }
    vi.mocked(readFile).mockClear();
    expect(await store.read()).toEqual(off);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails closed on non-ENOENT stat errors', async () => {
    const { store } = await fixture();
    vi.mocked(lstat).mockRejectedValueOnce(Object.assign(new Error('fixture'), { code: 'EACCES' }));
    expect(await store.read()).toEqual(off);
  });

  it.each(['EACCES', 'ENOENT'])('fails closed on %s read errors after a successful stat', async code => {
    const { file, store } = await fixture();
    await writeFile(file, JSON.stringify({ webSearch: true, codeSearch: true }));
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('fixture'), { code }));
    expect(await store.read()).toEqual(off);
  });

  it.each(['relative-agent', ''])('fails closed for invalid agent directory %s', async dir => {
    vi.mocked(lstat).mockClear();
    expect(await new SettingsStore(dir).read()).toEqual(off);
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['webSearch', 'codeSearch'] as const)('explicitly repairs only %s and preserves normal writes on restart', async flag => {
    const { dir, file, store } = await fixture();
    await writeFile(file, '{broken');
    const expected = { ...off, [flag]: true };
    expect(await store.update({ [flag]: true })).toEqual(expected);
    const restarted = new SettingsStore(dir);
    expect(await restarted.read()).toEqual(expected);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(expected);
    await restarted.update({ [flag]: false });
    expect(await new SettingsStore(dir).read()).toEqual(off);
  });
});
