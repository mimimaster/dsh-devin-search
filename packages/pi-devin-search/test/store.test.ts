import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevinError } from '../../../src/safety.js';
import {
  AuthStore, CREDENTIAL_FILE_NAME, CREDENTIAL_TEMP_PATTERN, EXPIRY_TIME_MAX, MAX_GRANT_BYTES, MAX_TOKEN_CHARS,
  MULTIPROCESS_WRITERS_SERIALIZED, parseGrant, PLUGIN_DIR_NAME, POSIX_MODE_CONFIDENTIALITY, shouldSyncDirectory, type Grant,
} from '../src/store.js';
import { cleanup, deferred, tempDir } from './helpers.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(cleanup)); });
const agent = async () => { const dir = await tempDir(); dirs.push(dir); return dir; };
const grant = (token = 'devin-session-token$fixture-token', expiresAt = 1_900_000_000_000): Grant => ({
  version: 1, token, expiresAt, expirySource: 'fallback',
});

describe('pi devin auth store', () => {
  it('documents that Windows mode bits are not a POSIX confidentiality boundary and writers are not cross-process locked', () => {
    expect(MULTIPROCESS_WRITERS_SERIALIZED).toBe(false);
    expect(POSIX_MODE_CONFIDENTIALITY).toBe(process.platform !== 'win32');
  });

  it('writes, rereads after restart, and deletes without touching auth.json, history, or sessions', async () => {
    const dir = await agent();
    await mkdir(join(dir, 'sessions'));
    await writeFile(join(dir, 'auth.json'), '{"provider":"keep"}');
    await writeFile(join(dir, 'history.jsonl'), 'keep-history');
    const first = new AuthStore(dir);
    await first.write(grant());
    const plugin = join(dir, PLUGIN_DIR_NAME);
    expect(await readFile(join(plugin, CREDENTIAL_FILE_NAME), 'utf8')).toContain('fixture-token');
    expect(await readFile(join(dir, 'auth.json'), 'utf8')).toBe('{"provider":"keep"}');
    expect(await readFile(join(dir, 'history.jsonl'), 'utf8')).toBe('keep-history');
    const restarted = new AuthStore(dir);
    expect(await restarted.read()).toEqual(grant());
    await restarted.delete();
    expect(await first.read()).toBeUndefined();
    await restarted.delete();
    expect(await readFile(join(dir, 'auth.json'), 'utf8')).toBe('{"provider":"keep"}');
  });

  it('forces POSIX 0700/0600 and does not claim that Windows modes match', async () => {
    const dir = await agent();
    await chmod(dir, 0o755);
    await mkdir(join(dir, PLUGIN_DIR_NAME), { mode: 0o755 });
    await writeFile(join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME), '{"stale":true}', { mode: 0o644 });
    const store = new AuthStore(dir);
    await store.write(grant());
    const dirMode = (await lstat(join(dir, PLUGIN_DIR_NAME))).mode & 0o777;
    const fileMode = (await lstat(join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME))).mode & 0o777;
    const agentMode = (await lstat(dir)).mode & 0o777;
    if (process.platform === 'win32') {
      expect(POSIX_MODE_CONFIDENTIALITY).toBe(false);
    } else {
      expect(POSIX_MODE_CONFIDENTIALITY).toBe(true);
      expect(dirMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
      expect(agentMode).toBe(0o755);
    }
  });

  it('rejects plugin-dir, destination, and temp symlinks without following them', async () => {
    if (process.platform === 'win32') {
      expect(POSIX_MODE_CONFIDENTIALITY).toBe(false);
      return;
    }
    const dir = await agent();
    const outside = join(dir, 'outside-secret');
    await writeFile(outside, 'untouched-outside');
    const linked = join(dir, 'linked-target');
    await mkdir(linked);
    await symlink(linked, join(dir, PLUGIN_DIR_NAME));
    const viaLink = new AuthStore(dir);
    await expect(viaLink.write(grant())).rejects.toThrow('unsafe');
    expect(await readFile(outside, 'utf8')).toBe('untouched-outside');
    await cleanup(join(dir, PLUGIN_DIR_NAME));

    await mkdir(join(dir, PLUGIN_DIR_NAME), { mode: 0o700 });
    await symlink(outside, join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME));
    await expect(new AuthStore(dir).write(grant('devin-session-token$should-not-follow'))).rejects.toThrow('unsafe');
    await expect(new AuthStore(dir).read()).rejects.toThrow('unsafe');
    expect(await readFile(outside, 'utf8')).toBe('untouched-outside');
    await cleanup(join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME));

    const tempStore = new AuthStore(dir, { tempBasename: 'credential-testtemp.tmp' });
    await symlink(outside, join(dir, PLUGIN_DIR_NAME, 'credential-testtemp.tmp'));
    await expect(tempStore.write(grant())).rejects.toThrow('unsafe');
    expect(await readFile(outside, 'utf8')).toBe('untouched-outside');
    expect(await readFile(outside, 'utf8')).not.toContain('should-not-follow');
  });

  it('rejects malformed, unknown, and capped records without leaking path or token', async () => {
    const dir = await agent();
    const store = new AuthStore(dir);
    const secret = 'LEAKED-TOKEN-XYZ';
    await expect(store.write({ ...grant(secret.repeat(20)), token: 't'.repeat(MAX_TOKEN_CHARS + 1) })).rejects.toBeInstanceOf(DevinError);
    await store.write(grant());
    const file = join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME);
    for (const raw of [
      '{',
      JSON.stringify({ version: 2, token: secret, expiresAt: 10, expirySource: 'fallback' }),
      JSON.stringify({ version: 1, token: secret, expiresAt: 'soon', expirySource: 'fallback' }),
      JSON.stringify({ version: 1, token: `${secret}\n`, expiresAt: 10, expirySource: 'fallback' }),
      JSON.stringify({ version: 1, token: secret, expiresAt: 10, expirySource: 'refresh' }),
      JSON.stringify({ version: 1, token: secret, expiresAt: 10, expirySource: 'jwt', extra: secret }),
      'x'.repeat(MAX_GRANT_BYTES + 1),
    ]) {
      await writeFile(file, raw);
      await expect(store.read()).rejects.toThrow('Devin credential record is invalid.');
      try { await store.read(); } catch (error) {
        expect(error).toBeInstanceOf(DevinError);
        expect(String(error)).not.toContain(secret);
        expect(String(error)).not.toContain(dir);
        expect(String(error)).not.toContain(PLUGIN_DIR_NAME);
      }
    }
  });

  it('serializes writers, keeps the previous record if commit fails, and sanitizes IO errors', async () => {
    const dir = await agent();
    const gate = deferred();
    let paused = 0;
    const store = new AuthStore(dir, {
      beforeCommit: async () => { paused++; if (paused === 1) await gate.promise; },
    });
    const first = store.write(grant('devin-session-token$A'));
    await vi.waitFor(() => expect(paused).toBe(1));
    const second = store.write(grant('devin-session-token$B'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(paused).toBe(1);
    gate.resolve();
    await first; await second;
    expect(await store.read()).toEqual(grant('devin-session-token$B'));
    expect((await lstat(join(dir, PLUGIN_DIR_NAME))).isDirectory()).toBe(true);

    const fileAgent = join(dir, 'not-a-directory');
    await writeFile(fileAgent, 'x');
    await expect(new AuthStore(fileAgent).read()).rejects.toThrow('unsafe');
    try { await new AuthStore(fileAgent).write(grant()); } catch (error) {
      expect(String(error)).not.toContain(fileAgent);
      expect(String(error)).not.toContain('fixture-token');
    }
  });

  it('skips POSIX directory fsync on Windows and does not claim that platform was validated', () => {
    expect(shouldSyncDirectory('win32')).toBe(false);
    expect(shouldSyncDirectory('darwin')).toBe(true);
    expect(shouldSyncDirectory('linux')).toBe(true);
    expect(CREDENTIAL_TEMP_PATTERN.test('credential-abcdef12.tmp')).toBe(true);
    expect(CREDENTIAL_TEMP_PATTERN.test('grant-abcdef12.tmp')).toBe(false);
    expect(CREDENTIAL_FILE_NAME).toBe('credentials.json');
  });

  it('still commits when directory fsync is skipped', async () => {
    const dir = await agent();
    const store = new AuthStore(dir, { syncDirectory: false });
    await store.write(grant());
    expect(await store.read()).toEqual(grant());
    expect(await readFile(join(dir, PLUGIN_DIR_NAME, CREDENTIAL_FILE_NAME), 'utf8')).toContain('fixture-token');
  });

  it('rejects expiry values that are not safe Date timestamps', () => {
    expect(() => parseGrant(Buffer.from(JSON.stringify({
      version: 1, token: 'abc', expiresAt: Number.MAX_VALUE, expirySource: 'fallback',
    })))).toThrow('invalid');
    expect(() => parseGrant(Buffer.from(JSON.stringify({
      version: 1, token: 'abc', expiresAt: EXPIRY_TIME_MAX + 1, expirySource: 'fallback',
    })))).toThrow('invalid');
    expect(() => parseGrant(Buffer.from(JSON.stringify({
      version: 1, token: 'abc', expiresAt: 1.5, expirySource: 'fallback',
    })))).toThrow('invalid');
  });

  it('round-trips only the known grant shape', () => {
    const parsed = parseGrant(Buffer.from(JSON.stringify({ version: 1, token: 'abc', expiresAt: 5, expirySource: 'jwt', revoked: false })));
    expect(parsed).toEqual({ version: 1, token: 'abc', expiresAt: 5, expirySource: 'jwt' });
    expect(parseGrant(Buffer.from(JSON.stringify({ ...parsed, revoked: true }))).revoked).toBe(true);
  });
});
