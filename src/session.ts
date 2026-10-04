import { execFile } from 'node:child_process'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import type { AuthorizationSession, AuthorizationService } from '@deepseek-ai/dsh-authorization';
import type { Context } from '@deepseek-ai/cordis';
import { oauth, type OAuthOptions } from './oauth.js';
import { abortable, check, deadline, expiry, fail, object, safeError, toDevinSessionToken } from './safety.js';

export const KEY = credentialKey('devin-search', 'session');
export interface Grant { version: 1; token: string; expiresAt: number; expirySource: 'jwt' | 'fallback'; revoked?: boolean }
function grant(record: Awaited<ReturnType<CredentialProvider['readRecord']>>): Grant | undefined {
  const p = record?.kind === 'grant' ? object(record.payload) : undefined;
  if (p?.version !== 1 || typeof p.token !== 'string' || !p.token || typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt) || !['jwt', 'fallback'].includes(String(p.expirySource))) return;
  return p as unknown as Grant;
}

/** Best-effort browser open so the user does not need a frozen URL card. */
function openExternal(url: string): void {
  try {
    if (process.platform === 'darwin') execFile('open', [url], () => {})
    else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {})
    else execFile('xdg-open', [url], () => {})
  } catch {
    // ignore — slash UI still shows a running "waiting for browser" state
  }
}

/** One owner for native flow AND slash-command login; never an independent auth fallback. */
export class Sessions {
  private snapshot?: Grant;
  private readVersion = 0;
  private epoch = 0;
  private clearing = false;
  private disposed = false;
  private attempt?: AbortController;
  private searches = new AbortController();
  private gate: Promise<unknown> = Promise.resolve();
  private background?: Promise<void>;
  private readonly runs = new Set<Promise<void>>();
  private last = 'Not logged in.';
  /** Auth continue URL for the in-flight slash login (tests + optional UI). */
  private pendingAuthUrl?: string
  constructor(private readonly ctx: Context, private readonly options: OAuthOptions = {}) {}
  /** In-flight browser login URL, if any. */
  getPendingAuthUrl(): string | undefined { return this.pendingAuthUrl }
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.gate.then(fn, fn); this.gate = next.catch(() => {}); return next;
  }
  invalidate(): void {
    this.readVersion++; this.snapshot = undefined;
    this.searches.abort(); this.searches = new AbortController();
  }
  async reload(): Promise<void> {
    const version = this.readVersion;
    try {
      const current = grant(await this.ctx.credentials.readRecord(KEY));
      if (version === this.readVersion) {
        if (this.snapshot?.token !== current?.token) { this.searches.abort(); this.searches = new AbortController(); }
        this.snapshot = current;
      }
    } catch { fail('storage', 'Unable to read Devin credentials from the host store.'); }
  }
  available(): boolean { return !this.disposed && !this.clearing && !!this.snapshot && !this.snapshot.revoked && this.snapshot.expiresAt > Date.now(); }
  async access(signal?: AbortSignal): Promise<{ token: string; signal: AbortSignal }> {
    if (signal?.aborted) check(signal);
    await this.reload();
    if (!this.available() || !this.snapshot) return fail('login', 'Devin session missing, expired or revoked; use /devin-login.');
    // Windsurf GetWebSearchResults / GetUserJwt require `devin-session-token$…`.
    return { token: toDevinSessionToken(this.snapshot.token), signal: deadline(AbortSignal.any([this.searches.signal, ...(signal ? [signal] : [])]), 90_000) };
  }
  async revoke(token: string): Promise<void> {
    const target = toDevinSessionToken(token)
    await this.locked(async () => {
      await this.ctx.credentials.modifyRecord(KEY, async current => {
        const p = grant(current);
        return p && toDevinSessionToken(p.token) === target
          ? { kind: 'grant', payload: { ...p, revoked: true } }
          : undefined;
      });
    });
    await this.reload();
  }
  run(session: AuthorizationSession): Promise<void> {
    const running = this.runFlow(session); this.runs.add(running);
    void running.finally(() => this.runs.delete(running)).catch(() => {});
    return running;
  }
  private async runFlow(session: AuthorizationSession): Promise<void> {
    if (this.disposed || this.clearing) return fail('cancelled', 'Devin login is unavailable during logout or unload.');
    const epoch = this.epoch; const controller = new AbortController(); this.attempt = controller;
    const signal = AbortSignal.any([session.signal, controller.signal]);
    this.last = 'Login pending.';
    try {
      const token = await oauth(signal, url => {
        this.pendingAuthUrl = url
        session.notify({ message: 'Continue Devin login in your browser.', url })
      }, this.options);
      check(signal);
      await this.locked(async () => {
        check(signal);
        if (epoch !== this.epoch || this.clearing || this.disposed) return fail('cancelled', 'Devin login was withdrawn.');
        // Logout joins this critical section even once DSH has admitted an atomic commit.
        // Persist Windsurf-ready form so status/access stay consistent across restarts.
        const sessionToken = toDevinSessionToken(token)
        await session.commit({ kind: 'grant', payload: { version: 1, token: sessionToken, ...expiry(sessionToken) } });
      });
      await this.reload(); this.last = 'Login saved.';
    } catch (error) { this.last = safeError(error); throw new Error(this.last); }
    finally { if (this.attempt === controller) this.attempt = undefined; }
  }
  /**
   * Slash `/devin-login`: stay in-flight until OAuth finishes so the command card
   * flips from running → success/cancel via durable outcome (no frozen URL row).
   */
  async login(signal: AbortSignal): Promise<string> {
    check(signal);
    if (this.ctx.authorization.describe(KEY)?.inFlight || this.background) {
      return 'Login already pending; use /devin-status or /devin-cancel.';
    }
    await this.reload();
    if (this.available() && this.snapshot) {
      return `Already logged in. Expires ${new Date(this.snapshot.expiresAt).toISOString()} (${this.snapshot.expirySource}; no automatic refresh).`;
    }

    this.pendingAuthUrl = undefined;
    const flow = this.ctx.authorization.begin({
      key: KEY,
      interaction: {
        notify: notice => {
          if (!notice.url) return
          this.pendingAuthUrl = notice.url
          openExternal(notice.url)
        },
        prompt: async () => { throw new Error('This flow does not use prompts.'); },
      },
    })
    this.background = flow.then(() => {}, () => {})
    try {
      const outcome = await abortable(flow, signal)
      if (outcome.status === 'authorized') {
        this.last = 'Login saved.'
        return 'Login saved.'
      }
      this.last = 'Login cancelled.'
      return 'Login cancelled.'
    } catch (error) {
      this.cancel()
      throw error
    } finally {
      this.pendingAuthUrl = undefined
      if (this.background) this.background = undefined
    }
  }
  cancel(): void { this.epoch++; this.attempt?.abort(); this.ctx.authorization.cancel(KEY); this.last = 'Login cancelled.'; }
  async logout(): Promise<void> {
    this.clearing = true; this.cancel(); this.invalidate();
    try { await this.locked(() => this.ctx.credentials.deleteRecord(KEY)); this.last = 'Logged out; stored Devin session cleared.'; }
    catch { fail('storage', 'Unable to clear Devin credentials in the host store.'); }
    finally { this.clearing = false; await this.reload(); }
  }
  async status(): Promise<string> {
    await this.reload();
    if (this.ctx.authorization.describe(KEY)?.inFlight) return 'Login pending.';
    if (!this.snapshot) return this.last;
    if (this.snapshot.revoked) return 'Session rejected by provider; use /devin-login.';
    return `${this.available() ? 'Logged in' : 'Session expired; use /devin-login'}. Expires ${new Date(this.snapshot.expiresAt).toISOString()} (${this.snapshot.expirySource}; no automatic refresh).`;
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.cancel(); this.invalidate();
    await Promise.allSettled([...this.runs, ...(this.background ? [this.background] : [])]);
  }
}
// Keep authorization augmentation visible to consumers of this module.
export type { AuthorizationService };
