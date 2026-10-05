import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { DevinError, fail, object } from '../../../src/safety.js';

/**
 * Plugin-owned credential file under the host agent directory.
 * Never reads or writes DSH credentials, pi `auth.json`, history, or session/project trees.
 *
 * In-process operations on one AuthStore are FIFO-serialized. There is no cross-process lock:
 * rename is atomic so readers see a complete old or new record, but two processes can lose updates.
 * Do not share one credentials file across processes. `MULTIPROCESS_WRITERS_SERIALIZED` is false.
 *
 * POSIX directory 0700 and file 0600 are applied with chmod. On Windows those mode bits are not an
 * equivalent confidentiality boundary (ACLs and owner semantics differ); `POSIX_MODE_CONFIDENTIALITY`
 * is false there. This package does not add ACLs or a keychain. Symlink rejection on Windows is
 * lstat-before-open and has a TOCTOU window because `O_NOFOLLOW` is not available; POSIX also passes
 * `O_NOFOLLOW` on open.
 *
 * After rename, POSIX opens the parent directory and fsyncs it. Windows skips that POSIX-only
 * directory open/fsync so a successful rename is not reported as a failure. Windows directory
 * durability was not validated in this environment.
 *
 * Stored name is `credentials.json` and temp names are `credential-*.tmp` so a custom agent
 * directory inside a workspace is excluded by the local sensitive-path matcher.
 */
export const PLUGIN_DIR_NAME = 'devin-search';
export const CREDENTIAL_FILE_NAME = 'credentials.json';
export const MAX_GRANT_BYTES = 64 * 1024;
export const MAX_TOKEN_CHARS = 16_384;
export const MULTIPROCESS_WRITERS_SERIALIZED = false;
export const POSIX_MODE_CONFIDENTIALITY = process.platform !== 'win32';
export const CREDENTIAL_TEMP_PATTERN = /^credential-[A-Za-z0-9]{8,64}\.tmp$/;
/** ECMAScript Date time-value limits. Values outside this range must not reach `toISOString`. */
export const EXPIRY_TIME_MIN = -8_640_000_000_000_000;
export const EXPIRY_TIME_MAX = 8_640_000_000_000_000;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const TEMP_NAME = CREDENTIAL_TEMP_PATTERN;

/** POSIX directory fsync is skipped on Windows. Not a claim that Windows was validated. */
export function shouldSyncDirectory(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

export interface Grant {
  version: 1;
  token: string;
  expiresAt: number;
  expirySource: 'jwt' | 'fallback';
  revoked?: boolean;
}

export interface StoreOptions {
  /** Deterministic temp name for tests. Production uses a random `credential-<hex>.tmp`. */
  tempBasename?: string;
  /** Invoked inside the store queue after the temp file is durable and before rename. */
  beforeCommit?: () => Promise<void> | void;
  /**
   * When false, skip the post-rename directory fsync. Default follows `shouldSyncDirectory()`
   * (false on Windows). Tests may force false; this is not a Windows validation.
   */
  syncDirectory?: boolean;
}

function unsafe(): never {
  return fail('storage', 'Devin credential path is unsafe.');
}
function invalid(): never {
  return fail('storage', 'Devin credential record is invalid.');
}
function io(): never {
  return fail('storage', 'Unable to access Devin credentials in the plugin store.');
}

function rethrowStore(error: unknown): never {
  if (error instanceof DevinError) throw error;
  return io();
}

export function parseGrant(bytes: Buffer): Grant {
  if (bytes.length > MAX_GRANT_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { invalid(); }
  const record = object(value);
  if (!record) invalid();
  const keys = Object.keys(record);
  if (keys.some(key => !['version', 'token', 'expiresAt', 'expirySource', 'revoked'].includes(key))) invalid();
  if (record.version !== 1) invalid();
  if (typeof record.token !== 'string' || !record.token || record.token.length > MAX_TOKEN_CHARS || /[\s\x00-\x1f\x7f]/.test(record.token)) invalid();
  if (typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt) || record.expiresAt < EXPIRY_TIME_MIN || record.expiresAt > EXPIRY_TIME_MAX) invalid();
  if (record.expirySource !== 'jwt' && record.expirySource !== 'fallback') invalid();
  if (record.revoked !== undefined && typeof record.revoked !== 'boolean') invalid();
  return {
    version: 1,
    token: record.token,
    expiresAt: record.expiresAt,
    expirySource: record.expirySource,
    ...(record.revoked === true ? { revoked: true } : {}),
  };
}

export class AuthStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly agentDir: string, private readonly options: StoreOptions = {}) {
    if (options.tempBasename !== undefined && !TEMP_NAME.test(options.tempBasename)) unsafe();
  }

  /** Serialized read. Missing grant is `undefined`; malformed or capped records throw a sanitized error. */
  read(): Promise<Grant | undefined> {
    return this.enqueue(() => this.readUnlocked());
  }

  write(grant: Grant): Promise<void> {
    return this.enqueue(() => this.writeUnlocked(grant));
  }

  delete(): Promise<void> {
    return this.enqueue(() => this.deleteUnlocked());
  }

  /**
   * Atomic read-modify-write inside the store queue.
   * Return the current record to keep it, a new record to replace it, or `undefined` to delete.
   */
  modify(fn: (current: Grant | undefined) => Promise<Grant | undefined> | Grant | undefined): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.readUnlocked();
      const next = await fn(current);
      if (next === current) return;
      if (next === undefined) {
        if (current) await this.deleteUnlocked();
        return;
      }
      if (current && JSON.stringify(parseGrant(Buffer.from(JSON.stringify(current)))) === JSON.stringify(parseGrant(Buffer.from(JSON.stringify(next))))) return;
      await this.writeUnlocked(next);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private pluginDir(): string {
    const dir = join(this.agentDir, PLUGIN_DIR_NAME);
    if (relative(this.agentDir, dir) !== PLUGIN_DIR_NAME) unsafe();
    return dir;
  }

  private async assertAgentDir(): Promise<void> {
    if (!isAbsolute(this.agentDir)) unsafe();
    let stat;
    try { stat = await lstat(this.agentDir); } catch { io(); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
  }

  private async ensurePluginDir(): Promise<string> {
    await this.assertAgentDir();
    const dir = this.pluginDir();
    let stat;
    try { stat = await lstat(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') io();
      try { await mkdir(dir, { mode: 0o700 }); }
      catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') io();
      }
      try { stat = await lstat(dir); } catch { io(); }
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
    try { await chmod(dir, 0o700); } catch { io(); }
    return dir;
  }

  private grantPath(dir: string): string {
    const file = join(dir, CREDENTIAL_FILE_NAME);
    if (relative(dir, file) !== CREDENTIAL_FILE_NAME) unsafe();
    return file;
  }

  private async readUnlocked(): Promise<Grant | undefined> {
    await this.assertAgentDir();
    const dir = this.pluginDir();
    let dirStat;
    try { dirStat = await lstat(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      io();
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) unsafe();
    const file = this.grantPath(dir);
    let stat;
    try { stat = await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      io();
    }
    if (stat.isSymbolicLink() || !stat.isFile()) unsafe();
    if (stat.size > MAX_GRANT_BYTES) invalid();
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | NOFOLLOW);
      const buf = Buffer.alloc(stat.size);
      if (stat.size > 0) {
        const read = await handle.read(buf, 0, stat.size, 0);
        if (read.bytesRead !== stat.size) invalid();
      }
      return parseGrant(buf.subarray(0, stat.size));
    } catch (error) { rethrowStore(error); }
    finally { await handle?.close().catch(() => {}); }
  }

  private async deleteUnlocked(): Promise<void> {
    await this.assertAgentDir();
    const dir = this.pluginDir();
    let dirStat;
    try { dirStat = await lstat(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      io();
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) unsafe();
    const file = this.grantPath(dir);
    let stat;
    try { stat = await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      io();
    }
    if (stat.isSymbolicLink() || !stat.isFile()) unsafe();
    try { await unlink(file); } catch (error) { rethrowStore(error); }
  }

  private async writeUnlocked(grant: Grant): Promise<void> {
    const payload = Buffer.from(JSON.stringify(parseGrant(Buffer.from(JSON.stringify({
      version: grant.version,
      token: grant.token,
      expiresAt: grant.expiresAt,
      expirySource: grant.expirySource,
      ...(grant.revoked === true ? { revoked: true } : {}),
    })))), 'utf8');
    if (payload.length > MAX_GRANT_BYTES) invalid();
    const dir = await this.ensurePluginDir();
    const file = this.grantPath(dir);
    let dest;
    try { dest = await lstat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') io();
    }
    if (dest?.isSymbolicLink() || (dest && !dest.isFile())) unsafe();
    const tempName = this.options.tempBasename ?? `credential-${randomBytes(16).toString('hex')}.tmp`;
    if (!TEMP_NAME.test(tempName)) unsafe();
    const temp = join(dir, tempName);
    if (relative(dir, temp) !== tempName) unsafe();
    let tempStat;
    try { tempStat = await lstat(temp); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') io();
    }
    if (tempStat) unsafe();
    let handle;
    let created = false;
    try {
      handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
      created = true;
      await handle.chmod(0o600);
      await handle.writeFile(payload);
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created) await rm(temp, { force: true }).catch(() => {});
      rethrowStore(error);
    }
    await handle.close().catch(() => {});
    try {
      await this.options.beforeCommit?.();
      let again;
      try { again = await lstat(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (again?.isSymbolicLink() || (again && !again.isFile())) unsafe();
      await rename(temp, file);
      created = false;
      await chmod(file, 0o600);
      if (this.options.syncDirectory ?? shouldSyncDirectory()) {
        const dirHandle = await open(dir, constants.O_RDONLY | NOFOLLOW);
        try { await dirHandle.sync(); } finally { await dirHandle.close(); }
      }
    } catch (error) {
      if (created) await rm(temp, { force: true }).catch(() => {});
      rethrowStore(error);
    }
  }
}
