import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { check, fail, object } from './safety.js';
export const LIMITS = { fileBytes: 512 * 1024, filesVisited: 512, entries: 4096, stepBytes: 24 * 1024, totalBytes: 192 * 1024, snippetBytes: 48 * 1024, finalFiles: 8 };
const forbidden = (path: string) => path.split(/[\\/]/).some(part => /^(?:\.git|node_modules|dist|build|coverage|\.next|\.cache|vendor|\.ssh|\.dsh|\.piwin)$/i.test(part) || /(?:^\.env(?:\.|$)|credential|secret|(?:^|[._-])(?:token|private.?key|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$)/i.test(part));
export function contains(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
interface Rule { base: string; matcher: Ignore }
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
  private entries = 0; private visited = 0; private bytes = 0;
  private files?: string[]; private rules: Rule[] = [];
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
  private async text(rel: string, ignoreRules = true): Promise<string> {
    if (ignoreRules && this.ignored(rel)) return fail('path', 'Ignored paths are excluded.');
    const path = await this.fence(rel);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMITS.fileBytes) return fail('bounds', 'File is not regular text or exceeds 512 KiB.');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); check(this.signal);
      if (bytesRead > LIMITS.fileBytes) return fail('bounds', 'File exceeded the byte budget.');
      const now = await lstat(await this.fence(rel));
      if (now.ino !== stat.ino || now.dev !== stat.dev) return fail('path', 'File changed identity during read.');
      const data = buffer.subarray(0, bytesRead);
      if (data.includes(0)) return fail('path', 'Binary files are excluded.');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return fail('path', 'Non-UTF8 files are excluded.'); }
    } finally { await handle.close(); }
  }
  async inventory(): Promise<string[]> {
    if (this.files) return this.files;
    const files: string[] = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      check(this.signal); if (depth > 24) return fail('bounds', 'Directory depth budget exceeded.');
      try {
        const text = await this.text(rel ? `${rel}/.gitignore` : '.gitignore', false);
        if (text.length > 32_768 || text.split('\n').length > 512 || text.split('\n').some(l => l.length > 512)) return fail('bounds', 'gitignore exceeds its safety budget.');
        this.rules.push({ base: rel || '.', matcher: ignore().add(text) });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const dir = await opendir(await this.fence(rel));
      for await (const entry of dir) {
        check(this.signal); if (++this.entries > LIMITS.entries) return fail('bounds', 'Directory entry budget exceeded.');
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || this.ignored(next, entry.isDirectory())) continue;
        if (entry.isDirectory()) await walk(next, depth + 1);
        else if (entry.isFile()) {
          if (++this.visited > LIMITS.filesVisited) return fail('bounds', 'File visit budget exceeded.');
          files.push(next);
        }
      }
    };
    await walk('', 0); this.files = files.sort(); return this.files;
  }
  private retain(text: string): string {
    const cut = Buffer.from(text).subarray(0, LIMITS.stepBytes).toString('utf8'); this.bytes += Buffer.byteLength(cut);
    if (this.bytes > LIMITS.totalBytes) return fail('bounds', 'Total command output budget exceeded.');
    return cut;
  }
  async execute(cmd: Command): Promise<string> {
    const files = await this.inventory(); check(this.signal);
    const rel = this.virtual(cmd.path ?? '/codebase');
    await this.fence(rel);
    if (cmd.op === 'readfile') {
      if (!files.includes(rel)) return fail('path', 'File is excluded from the search inventory.');
      const start = cmd.start ?? 1; const end = cmd.end ?? start + 199;
      if (end < start || end - start > 399) return fail('bounds', 'Read window exceeds 400 lines.');
      return this.retain((await this.text(rel)).split('\n').slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n'));
    }
    const selected = files.filter(f => rel === '' || f === rel || f.startsWith(`${rel}/`));
    if (cmd.op === 'rg') {
      if (!cmd.pattern) return fail('bounds', 'Literal rg requires a nonempty pattern.');
      const out: string[] = []; let size = 0;
      for (const file of selected) {
        check(this.signal); let text: string;
        try { text = await this.text(file); } catch (error) { if (error instanceof Error && error.name === 'DevinError' && !this.signal.aborted) continue; throw error; }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) if (lines[i]!.includes(cmd.pattern)) {
          const hit = `/codebase/${file}:${i + 1}: ${lines[i]!.slice(0, 2000)}`; out.push(hit); size += Buffer.byteLength(hit);
          if (size >= LIMITS.stepBytes) return this.retain(out.join('\n'));
        }
      }
      return this.retain(out.join('\n'));
    }
    const paths = selected.filter(f => cmd.op !== 'glob' || wildcard(cmd.pattern ?? '*', f));
    return this.retain(paths.filter(f => cmd.op !== 'ls' || !f.slice(rel ? rel.length + 1 : 0).includes('/')).map(f => `/codebase/${f}`).join('\n'));
  }
  async snippet(virtual: string, start: number, end: number): Promise<{ path: string; start: number; end: number; content: string }> {
    const rel = this.virtual(virtual); const files = await this.inventory();
    if (!files.includes(rel)) return fail('path', 'Answer file is excluded from the inventory.');
    if (end < start || start < 1 || end - start > 399) return fail('bounds', 'Answer range exceeds 400 lines.');
    const path = await this.fence(rel); const lines = (await this.text(rel)).split('\n');
    if (end > lines.length) return fail('bounds', 'Answer range exceeds file length.');
    return { path, start, end, content: lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n') };
  }
}
