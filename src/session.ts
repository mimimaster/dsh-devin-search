import { randomBytes } from 'node:crypto';
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import type { AuthorizationSession, AuthorizationService } from '@deepseek-ai/dsh-authorization';
import type { Context } from '@deepseek-ai/cordis';
import { oauth, oauthCode, validateCode, type OAuthOptions } from './oauth.js';
import type { LoginMode, LoginState } from './login-state.js';
import { abortable, check, deadline, expiry, fail, object, safeError, toDevinSessionToken } from './safety.js';

export const KEY = credentialKey('devin-search', 'session');
export interface Grant { version: 1; token: string; expiresAt: number; expirySource: 'jwt' | 'fallback'; revoked?: boolean }
function grant(record: Awaited<ReturnType<CredentialProvider['readRecord']>>): Grant | undefined {
  const p = record?.kind === 'grant' ? object(record.payload) : undefined;
  if (p?.version !== 1 || typeof p.token !== 'string' || !p.token || typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt) || !['jwt', 'fallback'].includes(String(p.expirySource))) return;
  return p as unknown as Grant;
}

interface LoginAttempt extends LoginState {
  acceptCode?: (code: string) => void;
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
  private loginAttempt?: LoginAttempt;
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
    const attempt: LoginAttempt = { attemptId: randomBytes(24).toString('base64url'), mode: session.method === 'code' ? 'code' : 'loopback', phase: 'pending' };
    this.loginAttempt = attempt;
    try {
      const notify = (url: string) => {
        this.pendingAuthUrl = url;
        session.notify({ message: attempt.mode === 'code' ? 'Open Devin in your browser, then paste the one-time authorization code into DSH.' : 'Continue Devin login in your browser.', url });
      };
      const token = attempt.mode === 'code'
        ? await oauthCode(signal, notify, life => session.prompt({ kind: 'secret', message: 'Paste the one-time Devin authorization code (not a session token).', signal: life }), this.options)
        : await oauth(signal, notify, this.options);
      check(signal);
      await this.locked(async () => {
        check(signal);
        if (epoch !== this.epoch || this.clearing || this.disposed) return fail('cancelled', 'Devin login was withdrawn.');
        // Logout joins this critical section even once DSH has admitted an atomic commit.
        // Persist Windsurf-ready form so status/access stay consistent across restarts.
        const sessionToken = toDevinSessionToken(token)
        await session.commit({ kind: 'grant', payload: { version: 1, token: sessionToken, ...expiry(sessionToken) } });
      });
      await this.reload();
      attempt.phase = epoch === this.epoch ? 'authorized' : 'cancelled';
      if (epoch === this.epoch) this.last = 'Login saved.';
    } catch (error) {
      attempt.phase = signal.aborted ? 'cancelled' : 'error';
      attempt.detail = safeError(error);
      if (epoch === this.epoch) this.last = attempt.detail;
      throw error;
    } finally {
      attempt.acceptCode = undefined;
      if (this.attempt === controller) { this.attempt = undefined; this.pendingAuthUrl = undefined; }
    }
  }
  /** Slash login returns a safe URL immediately; the authorization seam owns the background attempt. */
  async login(signal: AbortSignal, mode: LoginMode = 'code'): Promise<string> {
    check(signal);
    if (this.ctx.authorization.describe(KEY)?.inFlight || this.background) {
      return 'Login already pending; use /devin-status or /devin-cancel.';
    }
    await this.reload();
    if (this.available() && this.snapshot) {
      return `Already logged in. Expires ${new Date(this.snapshot.expiresAt).toISOString()} (${this.snapshot.expirySource}; no automatic refresh).`;
    }

    // reload() yields: recheck so concurrent commands cannot start two owners.
    if (this.ctx.authorization.describe(KEY)?.inFlight || this.background) return 'Login already pending; use /devin-status or /devin-cancel.';
    if (this.disposed || this.clearing) return fail('cancelled', 'Devin login is unavailable during logout or unload.');
    this.pendingAuthUrl = undefined;
    let ready!: (url: string) => void; let rejectReady!: (error: unknown) => void;
    const urlReady = new Promise<string>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    const flow = this.ctx.authorization.begin({
      key: KEY, method: mode === 'code' ? 'code' : 'oauth',
      interaction: {
        notify: notice => { if (notice.url) ready(notice.url); },
        prompt: question => {
          const attempt = this.loginAttempt;
          if (!attempt || attempt.mode !== 'code' || question.kind !== 'secret') return Promise.reject(new Error('Unexpected Devin authorization prompt.'));
          const pending = new Promise<string>(resolve => { attempt.acceptCode = resolve; });
          return abortable(pending, question.signal ?? this.attempt!.signal);
        },
      },
    });
    const background = flow.then(() => {}, () => {}).finally(() => { if (this.background === background) this.background = undefined; });
    this.background = background;
    void flow.then(() => rejectReady(new Error('Devin authorization ended before its URL was ready.')), error => rejectReady(error));
    try {
      const url = await abortable(urlReady, signal); check(signal);
      const attempt = this.loginAttempt!;
      return `Login pending.\nLogin attempt: ${attempt.attemptId}\nLogin mode: ${attempt.mode}\nOpen this URL: ${url}`;
    } catch (error) { this.cancel(); throw error; }
  }
  /** Only used by the authenticated Connection API, never by a chat command. */
  loginState(attemptId: string): LoginState | undefined {
    const attempt = this.loginAttempt;
    if (!attempt || attempt.attemptId !== attemptId) return;
    return { attemptId, mode: attempt.mode, phase: attempt.phase, ...(attempt.detail ? { detail: attempt.detail } : {}) };
  }
  async submitCode(attemptId: string, value: unknown, signal: AbortSignal): Promise<LoginState> {
    check(signal);
    const attempt = this.loginAttempt;
    if (!attempt || attempt.attemptId !== attemptId || attempt.mode !== 'code' || attempt.phase !== 'pending' || !attempt.acceptCode || !this.background) return fail('login', 'Devin login attempt is no longer waiting for a code.');
    const code = validateCode(value);
    const accept = attempt.acceptCode;
    const background = this.background;
    attempt.acceptCode = undefined; attempt.phase = 'exchanging';
    accept(code);
    // A disconnected submit request does not cancel a credential commit already in flight.
    await abortable(background, signal);
    return { attemptId, mode: attempt.mode, phase: attempt.phase, ...(attempt.detail ? { detail: attempt.detail } : {}) };
  }
  cancel(): void {
    this.epoch++;
    if (this.loginAttempt && ['pending', 'exchanging'].includes(this.loginAttempt.phase)) { this.loginAttempt.phase = 'cancelled'; this.loginAttempt.acceptCode = undefined; }
    this.attempt?.abort(); this.ctx.authorization.cancel(KEY); this.last = 'Login cancelled.';
  }
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
