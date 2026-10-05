import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { PLUGIN_DIR_NAME, shouldSyncDirectory } from './store.js';

/** Boolean switches only. Never tokens, codes, or URLs. Independent of credentials.json. */
export const SETTINGS_FILE_NAME = 'settings.json';
const TEMP_NAME = /^settings-[A-Za-z0-9]{8,64}\.tmp$/;

export interface SearchSettings {
  webSearch: boolean;
  codeSearch: boolean;
}

export const DEFAULT_SETTINGS: SearchSettings = { webSearch: true, codeSearch: true };

function fallback(): SearchSettings {
  return { ...DEFAULT_SETTINGS };
}

export class SettingsStore {
  constructor(private readonly agentDir: string) {}

  async read(): Promise<SearchSettings> {
    const file = this.filePath();
    if (!file) return fallback();
    let stat;
    try { stat = await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
      return fallback();
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) return fallback();
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback();
      const record = raw as Record<string, unknown>;
      return {
        webSearch: record.webSearch === false ? false : true,
        codeSearch: record.codeSearch === false ? false : true,
      };
    } catch {
      return fallback();
    }
  }

  async update(patch: Partial<SearchSettings>): Promise<SearchSettings> {
    const next = { ...(await this.read()), ...sanitize(patch) };
    await this.write(next);
    return next;
  }

  private filePath(): string | undefined {
    if (!isAbsolute(this.agentDir)) return undefined;
    const dir = join(this.agentDir, PLUGIN_DIR_NAME);
    if (relative(this.agentDir, dir) !== PLUGIN_DIR_NAME) return undefined;
    const file = join(dir, SETTINGS_FILE_NAME);
    if (relative(dir, file) !== SETTINGS_FILE_NAME) return undefined;
    return file;
  }

  private async write(settings: SearchSettings): Promise<void> {
    const file = this.filePath();
    if (!file) throw new Error('Devin search settings path is unsafe.');
    const dir = join(this.agentDir, PLUGIN_DIR_NAME);
    let dirStat;
    try { dirStat = await lstat(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to save Devin search settings.');
      await mkdir(dir, { mode: 0o700 });
      dirStat = await lstat(dir);
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('Devin search settings path is unsafe.');
    let dest;
    try { dest = await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to save Devin search settings.');
    }
    if (dest?.isSymbolicLink() || (dest && !dest.isFile())) throw new Error('Devin search settings path is unsafe.');
    const tempName = `settings-${randomBytes(8).toString('hex')}.tmp`;
    if (!TEMP_NAME.test(tempName)) throw new Error('Devin search settings path is unsafe.');
    const temp = join(dir, tempName);
    const payload = Buffer.from(JSON.stringify({ webSearch: settings.webSearch, codeSearch: settings.codeSearch }), 'utf8');
    let handle;
    let created = false;
    try {
      handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      created = true;
      await handle.writeFile(payload);
      await handle.sync();
    } catch {
      await handle?.close().catch(() => {});
      if (created) await rm(temp, { force: true }).catch(() => {});
      throw new Error('Unable to save Devin search settings.');
    }
    await handle.close().catch(() => {});
    try {
      await rename(temp, file);
      created = false;
      await chmod(file, 0o600).catch(() => {});
      if (shouldSyncDirectory()) {
        const dirHandle = await open(dir, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { await dirHandle.sync(); } finally { await dirHandle.close(); }
      }
    } catch {
      if (created) await rm(temp, { force: true }).catch(() => {});
      throw new Error('Unable to save Devin search settings.');
    }
  }
}

function sanitize(patch: Partial<SearchSettings>): Partial<SearchSettings> {
  const next: Partial<SearchSettings> = {};
  if (patch.webSearch !== undefined) next.webSearch = patch.webSearch !== false;
  if (patch.codeSearch !== undefined) next.codeSearch = patch.codeSearch !== false;
  return next;
}
