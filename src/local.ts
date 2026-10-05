import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { check, fail, object } from './safety.js';
export const LIMITS = { fileBytes: 512 * 1024, filesVisited: 512, entries: 4096, totalFilesVisited: 4096, totalEntries: 32768, stepReadBytes: 8 * 1024 * 1024, totalReadBytes: 32 * 1024 * 1024, stepBytes: 24 * 1024, totalBytes: 192 * 1024, snippetBytes: 48 * 1024, finalFiles: 8 };
const forbidden = (path: string) => path.split(/[\\/]/).some(part => /^(?:\.git|node_modules|dist|build|coverage|\.next|\.cache|vendor|\.ssh|\.dsh|\.piwin|\.pi)$/i.test(part) || /(?:^\.env(?:\.|$)|credential|secret|(?:^|[._-])(?:token|private.?key|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$)/i.test(part));
export function contains(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
interface Rule { base: string; matcher: Ignore }
interface Scan { entries: number; files: number; partial: boolean }
interface CachedText { text: string; ino: number; dev: number; size: number; mtimeMs: number; ctimeMs: number }
const PARTIAL = '\n[PARTIAL] Scan/output limit reached; this is not proof of no matches. Use ls to discover directories, then narrow the command path and continue. Only return verified file ranges.';
/** Literal grep + bounded wildcard DP: no model-controlled JavaScript regular expression or shell. */
function wildcard(pattern: string, text: string): boolean {
  let row = new Array<boolean>(text.length + 1).fill(false); row[0] = true;
  for (const ch of pattern) {
    const next = new Array<boolean>(text.length + 1).fill(false); next[0] = ch === '*' && row[0]!;
    for (let i = 1; i <= text.length; i++) next[i] = ch === '*' ? next[i - 1]! || row[i]! : (ch === '?' || ch === text[i - 1]) && row[i - 1]!;
    row = next;
  }
  return row[text.length]!;
}
export interface Command { op: 'rg' | 'readfile' | 'tree' | 'ls' | 'glob'; path?: string; pattern?: string; start?: number; end?: number }
export function command(value: unknown): Command {
  const v = object(value);
  if (!v || !['rg', 'readfile', 'tree', 'ls', 'glob'].includes(String(v.op)) || Object.keys(v).some(k => !['op', 'path', 'pattern', 'start', 'end'].includes(k))) return fail('protocol', 'Invalid restricted_exec command.');
  if (v.path !== undefined && (typeof v.path !== 'string' || v.path.length > 1024)) return fail('bounds', 'Invalid command path.');
  if (v.pattern !== undefined && (typeof v.pattern !== 'string' || v.pattern.length > 256)) return fail('bounds', 'Search pattern exceeds its budget.');
  for (const n of [v.start, v.end]) if (n !== undefined && (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 1_000_000)) return fail('bounds', 'Invalid line window.');
  return v as unknown as Command;
}
export class LocalWorkspace {
  private entries = 0; private visited = 0; private bytes = 0; private readBytes = 0;
  private files?: string[]; private rules: Rule[] = []; private loadedRules = new Set<string>(); private visitedPaths = new Set<string>();
  private textCache = new Map<string, CachedText>();
  partial = false;
  constructor(readonly root: string, private readonly signal: AbortSignal) {}
  static async create(cwd: string | undefined, folder: string, mapping: (p: string) => string | undefined, signal: AbortSignal): Promise<LocalWorkspace> {
    check(signal);
    if (!cwd || !isAbsolute(cwd) || !isAbsolute(folder)) return fail('path', 'code_search requires an authoritative local session cwd and an absolute search folder.');
    try {
      const host = await realpath(cwd); const mapped = mapping(host);
      if (!mapped || resolve(mapped) !== host) return fail('path', 'code_search supports only a host-local filesystem mapping.');
      const root = await realpath(folder);
      if (!contains(host, root) || !(await lstat(root)).isDirectory() || forbidden(relative(host, root))) return fail('path', 'Search folder must be inside the local session workspace.');
      return new LocalWorkspace(root, signal);
    } catch (error) { if (error instanceof Error && error.name === 'DevinError') throw error; return fail('path', 'Unable to resolve a permitted local search folder.'); }
  }
  virtual(path: string): string {
    if (path === '/codebase' || path === '.' || path === '') return '';
    if (!path.startsWith('/codebase/') || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.')) return fail('path', 'Only contained /codebase virtual paths are permitted.');
    const rel = path.slice('/codebase/'.length);
    if (forbidden(rel)) return fail('path', 'Sensitive or generated paths are excluded.');
    return rel;
  }
  private async fence(rel: string): Promise<string> {
    check(this.signal);
    if (forbidden(rel)) return fail('path', 'Sensitive or generated paths are excluded.');
    const path = resolve(this.root, rel);
    if (!contains(this.root, path)) return fail('path', 'Path escapes the local workspace.');
    let current = this.root;
    for (const part of rel.split('/').filter(Boolean)) {
      current = resolve(current, part); const info = await lstat(current);
      if (info.isSymbolicLink()) return fail('path', 'Symlinks are excluded from code_search.');
    }
    if (await realpath(path) !== path || await realpath(this.root) !== this.root) return fail('path', 'Workspace path changed or escaped.');
    return path;
  }
  private ignored(rel: string, directory = false): boolean {
    return forbidden(rel) || this.rules.some(rule => {
      const r = relative(rule.base, rel).split(sep).join('/');
      return r && !r.startsWith('../') && rule.matcher.ignores(r + (directory ? '/' : ''));
    });
  }
  private async text(rel: string, ignoreRules = true, reuse = false): Promise<string> {
    if (ignoreRules && this.ignored(rel)) return fail('path', 'Ignored paths are excluded.');
    const path = await this.fence(rel);
    const cached = reuse ? this.textCache.get(rel) : undefined;
    if (cached) {
      const now = await lstat(path);
      if (now.isFile() && now.ino === cached.ino && now.dev === cached.dev && now.size === cached.size && now.mtimeMs === cached.mtimeMs && now.ctimeMs === cached.ctimeMs) return cached.text;
      this.textCache.delete(rel);
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMITS.fileBytes) return fail('bounds', 'File is not regular text or exceeds 512 KiB.');
      if (stat.size + 1 > LIMITS.totalReadBytes - this.readBytes) return fail('bounds', 'Total file read budget exceeded.');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); this.readBytes += bytesRead; check(this.signal);
      if (bytesRead > LIMITS.fileBytes) return fail('bounds', 'File exceeded the byte budget.');
      const now = await lstat(await this.fence(rel));
      if (now.ino !== stat.ino || now.dev !== stat.dev) return fail('path', 'File changed identity during read.');
      const data = buffer.subarray(0, bytesRead);
      if (data.includes(0)) return fail('path', 'Binary files are excluded.');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return fail('path', 'Non-UTF8 files are excluded.'); }
      // The cumulative physical-read cap also bounds cache memory. Final snippets always bypass this cache.
      if (reuse) this.textCache.set(rel, { text, ino: stat.ino, dev: stat.dev, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
      return text;
    } finally { await handle.close(); }
  }
  private async loadRules(rel: string): Promise<void> {
    if (this.loadedRules.has(rel)) return;
    try {
      const text = await this.text(rel ? `${rel}/.gitignore` : '.gitignore', false);
      if (text.length > 32_768 || text.split('\n').length > 512 || text.split('\n').some(l => l.length > 512)) return fail('bounds', 'gitignore exceeds its safety budget.');
      this.rules.push({ base: rel || '.', matcher: ignore().add(text) });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.loadedRules.add(rel);
  }
  /** Load ancestor ignore rules before touching a directly requested path. Never enumerate siblings. */
  private async prepare(rel: string): Promise<void> {
    await this.loadRules('');
    let current = '';
    for (const part of rel.split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const path = await this.fence(current); const info = await lstat(path);
      if (this.ignored(current, info.isDirectory())) return fail('path', 'Ignored paths are excluded.');
      if (info.isDirectory()) await this.loadRules(current);
    }
  }
  /** Stream only the requested subtree. Per-command limits produce explicit partial results. */
  private async *walk(rel: string, scan: Scan, recursive: boolean, directories: boolean, maxDepth = 24, depth = 0): AsyncGenerator<string> {
    check(this.signal);
    const path = await this.fence(rel); const info = await lstat(path);
    if (info.isFile()) {
      if (++scan.files > LIMITS.filesVisited) { scan.partial = true; return; }
      if (!this.visitedPaths.has(rel)) {
        if (++this.visited > LIMITS.totalFilesVisited) return fail('bounds', 'Total distinct file visit budget exceeded.');
        this.visitedPaths.add(rel);
      }
      yield rel; return;
    }
    if (!info.isDirectory()) return;
    await this.loadRules(rel);
    const dir = await opendir(path);
    for await (const entry of dir) {
      check(this.signal);
      if (++scan.entries > LIMITS.entries) { scan.partial = true; return; }
      if (++this.entries > LIMITS.totalEntries) return fail('bounds', 'Total directory entry budget exceeded.');
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || this.ignored(next, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        if (directories) yield `${next}/`;
        if (recursive) {
          if (depth >= maxDepth) scan.partial = true;
          else yield* this.walk(next, scan, recursive, directories, maxDepth, depth + 1);
        }
      } else if (entry.isFile()) yield* this.walk(next, scan, recursive, directories, maxDepth, depth);
      if (scan.entries > LIMITS.entries || scan.files > LIMITS.filesVisited) return;
    }
  }
  /** Bounded diagnostic inventory; production commands and final snippets do not depend on it. */
  async inventory(): Promise<string[]> {
    if (this.files) return this.files;
    await this.prepare('');
    const scan: Scan = { entries: 0, files: 0, partial: false }; const files: string[] = [];
    for await (const file of this.walk('', scan, true, false)) files.push(file);
    if (scan.partial) return fail('bounds', 'File visit or directory entry budget exceeded.');
    this.files = files.sort(); return this.files;
  }
  private retain(text: string): string {
    const cut = Buffer.from(text).subarray(0, LIMITS.stepBytes).toString('utf8'); this.bytes += Buffer.byteLength(cut);
    if (this.bytes > LIMITS.totalBytes) return fail('bounds', 'Total command output budget exceeded.');
    return cut;
  }
  async execute(cmd: Command): Promise<string> {
    check(this.signal); const rel = this.virtual(cmd.path ?? '/codebase');
    await this.prepare(rel);
    if (cmd.op === 'readfile') {
      if ((await lstat(await this.fence(rel))).isDirectory()) return this.retain('Path is a directory, not a file. Use ls or tree here to discover a file, then readfile on that exact path.');
      const start = cmd.start ?? 1; const end = cmd.end ?? start + 199;
      if (end < start || end - start > 399) return fail('bounds', 'Read window exceeds 400 lines.');
      return this.retain((await this.text(rel, true, true)).split('\n').slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n'));
    }
    if (cmd.op === 'rg' && !cmd.pattern) return fail('bounds', 'Literal rg requires a nonempty pattern.');
    const scan: Scan = { entries: 0, files: 0, partial: false }; const out: string[] = [];
    let size = 0; const readStart = this.readBytes;
    const append = (line: string): boolean => {
      const bytes = Buffer.byteLength(line) + 1;
      if (size + bytes > LIMITS.stepBytes - 512) { scan.partial = true; return false; }
      out.push(line); size += bytes; return true;
    };
    outer: for await (const file of this.walk(rel, scan, cmd.op !== 'ls', cmd.op === 'ls' || cmd.op === 'tree', cmd.op === 'tree' ? 2 : 24)) {
      if (cmd.op !== 'rg') {
        if ((cmd.op !== 'glob' || wildcard(cmd.pattern ?? '*', file)) && !append(`/codebase/${file}`)) break;
        continue;
      }
      if (this.readBytes - readStart >= LIMITS.stepReadBytes) { scan.partial = true; break; }
      let text: string;
      try { text = await this.text(file, true, true); }
      catch (error) {
        check(this.signal);
        if (error instanceof Error && error.message.startsWith('Total file read budget')) { scan.partial = true; break; }
        // Skip unusable text, not path-race or cancellation failures.
        if (error instanceof Error && /^(File is not regular text|Binary files|Non-UTF8 files)/.test(error.message)) continue;
        throw error;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) if (lines[i]!.includes(cmd.pattern!)) {
        if (!append(`/codebase/${file}:${i + 1}: ${lines[i]!.slice(0, 2000)}`)) break outer;
      }
    }
    this.partial ||= scan.partial;
    return this.retain(out.join('\n') + (scan.partial ? PARTIAL : ''));
  }
  async snippet(virtual: string, start: number, end: number): Promise<{ path: string; start: number; end: number; content: string }> {
    const rel = this.virtual(virtual); await this.prepare(rel);
    if (end < start || start < 1 || end - start > 399) return fail('bounds', 'Answer range exceeds 400 lines.');
    const path = await this.fence(rel); const lines = (await this.text(rel, true, true)).split('\n');
    if (end > lines.length) return fail('bounds', 'Answer range exceeds file length.');
    return { path, start, end, content: lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n') };
  }
}
