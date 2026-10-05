import type { SearchSession } from './search-session.js';
import { chatRequest, gzipFrame, JWT_PATH, jwtRequest, jwtResponse, MODEL, STREAM_PATH, streamText, type Message } from './protocol.js';
import { boundedBody, check, deadline, expiry, fail, redact, request } from './safety.js';
export interface Completion { complete(system: string, messages: readonly Message[], tools: string, signal: AbortSignal): Promise<string> }
/** Private search client; deliberately not a DSH model adapter. */
export class WindsurfCompletion implements Completion {
  private cached?: { token: string; jwt: string; until: number };
  private version = 0;
  readonly model = MODEL; // Endpoint's current default; no unverified protobuf model field is invented.
  constructor(private readonly sessions: SearchSession, private readonly options: { base?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}) {}
  invalidate(): void { this.version++; this.cached = undefined; }
  async complete(system: string, messages: readonly Message[], tools: string, caller: AbortSignal): Promise<string> {
    const access = await this.sessions.access(caller); const signal = deadline(access.signal, this.options.timeoutMs ?? 30_000);
    const token = access.token; const version = this.version;
    const post = async (path: string, body: Buffer, framed = false): Promise<Buffer> => {
      const response = await request(`${this.options.base ?? 'https://server.self-serve.windsurf.com'}${path}`, {
        method: 'POST', headers: { 'content-type': framed ? 'application/connect+proto' : 'application/proto', 'connect-protocol-version': '1', ...(framed ? { 'connect-accept-encoding': 'gzip', 'connect-content-encoding': 'gzip', 'connect-timeout-ms': '30000' } : {}) }, body: new Uint8Array(body),
      }, signal, this.options.fetcher);
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel(); this.invalidate(); await this.sessions.revoke(token);
        return fail('login', 'Devin session rejected; use /devin-login.');
      }
      if (!response.ok) { await response.body?.cancel(); return fail('network', 'Devin completion request failed.'); }
      return boundedBody(response, signal, framed ? 4 * 1024 * 1024 : 64 * 1024);
    };
    let jwt: string;
    if (this.cached?.token === token && this.cached.until > Date.now()) jwt = this.cached.jwt;
    else {
      jwt = jwtResponse(await post(JWT_PATH, jwtRequest(token))) ?? '';
      if (!jwt || jwt.length > 16_384) return fail('protocol', 'Devin returned no valid search JWT.');
      check(signal);
      if (version !== this.version) return fail('cancelled', 'Devin credentials changed during search.');
      this.cached = { token, jwt, until: Math.min(expiry(jwt).expiresAt, Date.now() + 5 * 60_000) };
    }
    const text = streamText(await post(STREAM_PATH, gzipFrame(chatRequest(token, jwt, system, messages, tools)), true));
    check(signal);
    if (version !== this.version) return fail('cancelled', 'Devin credentials changed during search.');
    return redact(text, [token, jwt]);
  }
}
