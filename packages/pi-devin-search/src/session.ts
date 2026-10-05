import type { SearchSession } from '../../../src/search-session.js';
import { oauth, oauthCode, type OAuthOptions } from '../../../src/oauth.js';
import { check, deadline, DevinError, expiry, fail, safeError, toDevinSessionToken } from '../../../src/safety.js';
import { AuthStore, EXPIRY_TIME_MAX, EXPIRY_TIME_MIN, type Grant } from './store.js';

/**
 * Pi-host credential owner. Shared OAuth/search helpers are relative imports so a later esbuild
 * bundle can inline them. This module does not import pi or DSH and never reads auth.json.
 *
 * There is no refresh grant. Status text must say so and must not include tokens, codes, or URLs.
 * One login owner. logout/cancel/dispose bump the epoch so a login that has not passed the commit
 * check cannot write; a write already inside the lock is rolled back if the epoch moved.
 * In-flight search signals are aborted on credential identity changes.
 */
export interface LoginInteraction {
  /** Non-interactive hosts must pass false. Login is rejected and no URL or prompt is issued. */
  readonly hasUI: boolean;
  notify(url: string): void;
  prompt(signal: AbortSignal): Promise<string>;
}

export interface AuthSessionOptions extends OAuthOptions {
  /** Default `code` uses PKCE `oauthCode`. `loopback` uses the optional localhost callback. */
  mode?: 'code' | 'loopback';
  now?: () => number;
  /** Lets a future runtime drop cached cloud credentials when the grant identity changes. */
  onInvalidate?: () => void;
}

const LOGIN_REQUIRED = 'Devin login requires an interactive UI.';
const PENDING = 'Login already pending.';
const WITHDRAWN = 'Devin login was withdrawn.';
const UNAVAILABLE = 'Devin login is unavailable during logout or unload.';
const ACCESS_DENIED = 'Devin session missing, expired or revoked; use /devin-login.';

/** Bound expiry to a safe integer Date before any ISO formatting. Out-of-range values are omitted. */
export function formatExpiry(expiresAt: number): string | undefined {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < EXPIRY_TIME_MIN || expiresAt > EXPIRY_TIME_MAX) return undefined;
  return new Date(expiresAt).toISOString();
}

export class AuthSession implements SearchSession {
  private snapshot?: Grant;
  private readVersion = 0;
  private epoch = 0;
  private clearing = false;
  private disposed = false;
  private inflight = false;
  private attemptMode?: 'code' | 'loopback';
  private attempt?: AbortController;
  private searches = new AbortController();
  private gate: Promise<unknown> = Promise.resolve();
  private background?: Promise<void>;
  private disposeOnce?: Promise<void>;
  private last = 'Not logged in.';

  constructor(private readonly store: AuthStore, private readonly options: AuthSessionOptions = {}) {}

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private mode(): 'code' | 'loopback' {
    if (this.attemptMode === 'loopback' || this.attemptMode === 'code') return this.attemptMode;
    return this.options.mode === 'loopback' ? 'loopback' : 'code';
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.gate.then(fn, fn);
    this.gate = next.then(() => undefined, () => undefined);
    return next;
  }

  private identity(grant?: Grant): string {
    return grant ? `${grant.revoked ? 1 : 0}\0${grant.expiresAt}\0${grant.token}` : '';
  }

  private abortSearches(): void {
    this.searches.abort();
    this.searches = new AbortController();
  }

  private adopt(next: Grant | undefined): void {
    const previous = this.identity(this.snapshot);
    this.snapshot = next;
    if (previous !== this.identity(next)) {
      this.abortSearches();
      this.options.onInvalidate?.();
    }
  }

  private async reload(): Promise<void> {
    const version = this.readVersion;
    const current = await this.store.read();
    if (version !== this.readVersion) return;
    this.adopt(current);
  }

  available(): boolean {
    return !this.disposed && !this.clearing && !!this.snapshot && !this.snapshot.revoked && this.snapshot.expiresAt > this.now();
  }

  /** Refreshes the grant snapshot, then returns a search signal aborted by logout, revoke, or dispose. */
  async access(signal?: AbortSignal): Promise<{ token: string; signal: AbortSignal }> {
    if (signal?.aborted) check(signal);
    if (this.disposed || this.clearing) fail('cancelled', UNAVAILABLE);
    await this.reload();
    if (signal?.aborted) check(signal);
    if (this.disposed || this.clearing) fail('cancelled', UNAVAILABLE);
    const grant = this.snapshot;
    if (!grant || !this.available()) return fail('login', ACCESS_DENIED);
    const linked = AbortSignal.any([this.searches.signal, ...(signal ? [signal] : [])]);
    return { token: toDevinSessionToken(grant.token), signal: deadline(linked, 90_000) };
  }

  /** Queued behind the login lock. Revokes only the grant whose token matches; a newer grant is left intact. */
  async revoke(token: string): Promise<void> {
    const target = toDevinSessionToken(token);
    await this.locked(async () => {
      await this.store.modify(current => {
        if (!current || toDevinSessionToken(current.token) !== target) return current;
        return { ...current, revoked: true };
      });
    });
    await this.reload();
  }

  /**
   * Interactive login. Resolves to a safe status string.
   * The authorization URL is delivered only through `interaction.notify`.
   */
  /**
   * Interactive login. `mode` applies only to this attempt.
   * A pending owner is not replaced and its mode is not changed.
   */
  async login(interaction: LoginInteraction, signal: AbortSignal = new AbortController().signal, mode?: 'code' | 'loopback'): Promise<string> {
    if (!interaction.hasUI) fail('login', LOGIN_REQUIRED);
    if (this.disposed || this.clearing) fail('cancelled', UNAVAILABLE);
    if (this.inflight) return PENDING;
    this.inflight = true;
    let owned = false;
    try {
      check(signal);
      await this.reload();
      if (this.disposed || this.clearing) fail('cancelled', UNAVAILABLE);
      if (this.available() && this.snapshot) {
        const when = formatExpiry(this.snapshot.expiresAt) ?? 'unavailable';
        return `Already logged in. Expires ${when} (${this.snapshot.expirySource}; no automatic refresh).`;
      }
      check(signal);
      owned = true;
      const run = this.runFlow(interaction, signal, mode);
      const settled = run.finally(() => {
        this.inflight = false;
        if (this.background === settled) this.background = undefined;
      });
      this.background = settled;
      await settled;
      return 'Login saved.';
    } finally {
      if (!owned) this.inflight = false;
    }
  }

  private async capturePrompt(interaction: LoginInteraction, signal: AbortSignal): Promise<string> {
    check(signal);
    try {
      const value = await interaction.prompt(signal);
      check(signal);
      return value;
    } catch (error) {
      if (signal.aborted) return fail('cancelled', 'Devin operation cancelled or timed out.');
      if (error instanceof DevinError) throw error;
      return fail('login', 'Devin authorization code was not accepted.');
    }
  }

  private async runFlow(interaction: LoginInteraction, caller: AbortSignal, mode?: 'code' | 'loopback'): Promise<void> {
    const epoch = this.epoch;
    const previousMode = this.attemptMode;
    this.attemptMode = mode;
    const controller = new AbortController();
    this.attempt = controller;
    const signal = AbortSignal.any([caller, controller.signal]);
    this.last = 'Login pending.';
    try {
      const notify = (url: string): void => {
        try { interaction.notify(url); }
        catch { fail('login', 'Devin login could not be presented.'); }
      };
      const token = this.mode() === 'loopback'
        ? await oauth(signal, notify, this.options)
        : await oauthCode(signal, notify, life => this.capturePrompt(interaction, life), this.options);
      check(signal);
      const sessionToken = toDevinSessionToken(token);
      await this.locked(async () => {
        check(signal);
        if (epoch !== this.epoch || this.clearing || this.disposed) fail('cancelled', WITHDRAWN);
        const grant: Grant = { version: 1, token: sessionToken, ...expiry(sessionToken, this.now()) };
        await this.store.write(grant);
        if (epoch !== this.epoch || this.clearing || this.disposed) {
          await this.store.modify(current => current && toDevinSessionToken(current.token) === sessionToken ? undefined : current);
          fail('cancelled', WITHDRAWN);
        }
      });
      if (epoch === this.epoch && !this.disposed) this.last = 'Login saved.';
      await this.reload();
    } catch (error) {
      if (epoch === this.epoch && !this.clearing) this.last = signal.aborted ? 'Login cancelled.' : safeError(error);
      if (error instanceof DevinError) throw error;
      fail('login', 'Devin operation failed. No provider details were retained.');
    } finally {
      this.attemptMode = previousMode;
      if (this.attempt === controller) this.attempt = undefined;
    }
  }

  async status(): Promise<string> {
    await this.reload();
    if (this.disposed) return 'Login unavailable.';
    if (this.inflight) return 'Login pending.';
    if (!this.snapshot) return this.last;
    if (this.snapshot.revoked) return 'Session rejected by provider; use /devin-login.';
    const when = formatExpiry(this.snapshot.expiresAt);
    const refresh = `${this.snapshot.expirySource}; no automatic refresh`;
    if (!when) {
      return this.available()
        ? `Logged in. Expiry unavailable (${refresh}).`
        : `Session expired; use /devin-login. Expiry unavailable (${refresh}).`;
    }
    return this.available()
      ? `Logged in. Expires ${when} (${refresh}).`
      : `Session expired; use /devin-login. Expires ${when} (${refresh}).`;
  }

  cancel(): void {
    this.epoch++;
    this.attempt?.abort();
    this.abortSearches();
    this.last = 'Login cancelled.';
  }

  async logout(): Promise<void> {
    this.clearing = true;
    this.cancel();
    this.readVersion++;
    this.adopt(undefined);
    try {
      await this.locked(() => this.store.delete());
      this.last = 'Logged out; stored Devin session cleared.';
    } catch (error) {
      if (error instanceof DevinError) throw error;
      fail('storage', 'Unable to clear Devin credentials in the plugin store.');
    } finally {
      this.clearing = false;
      await this.reload();
    }
  }

  /** Idempotent. Aborts login and searches; does not delete a grant that was not withdrawn. */
  async dispose(): Promise<void> {
    if (this.disposeOnce) return this.disposeOnce;
    this.disposeOnce = (async () => {
      this.disposed = true;
      this.cancel();
      this.readVersion++;
      this.abortSearches();
      this.adopt(undefined);
      const pending = this.background;
      if (pending) await pending.catch(() => {});
    })();
    return this.disposeOnce;
  }
}
