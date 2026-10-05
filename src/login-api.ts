import type { Context } from '@deepseek-ai/cordis';
import { ATTEMPT_ID, LOGIN_CODE_PATH, LOGIN_STATE_PATH } from './login-state.js';
import type { Sessions } from './session.js';
import { boundedBody, object, safeError } from './safety.js';

/** Narrow structural seam from DSH client-connection's HostConnectionHandle.
 * Optional injection keeps CLI/native authorization usable without a Web transport.
 */
export interface LoginConnection {
  requestRejection(request: { headers: Headers }): 401 | 403 | undefined;
  fetch: { register(route: { path: string; methods: readonly ('GET' | 'POST')[]; requestBody: 'streaming'; fetch(request: Request): Promise<Response> }): () => Promise<void> };
}
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Uses Connection's existing Host/Origin fence and browser authentication, not a new HTTP listener. */
export function registerLoginApi(connection: LoginConnection, sessions: Sessions): () => Promise<void> {
  const state = connection.fetch.register({ path: LOGIN_STATE_PATH, methods: ['GET'], requestBody: 'streaming', async fetch(request) {
    const rejected = connection.requestRejection(request);
    if (rejected) return reply({ error: 'DSH authentication required.' }, rejected);
    const id = new URL(request.url).searchParams.get('attemptId') ?? '';
    if (!ATTEMPT_ID.test(id)) return reply({ error: 'Invalid login attempt.' }, 400);
    const value = sessions.loginState(id);
    return value ? reply(value) : reply({ error: 'Login attempt expired or replaced. Use /devin-login again.' }, 404);
  } });
  const code = connection.fetch.register({ path: LOGIN_CODE_PATH, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    const rejected = connection.requestRejection(request);
    if (rejected) return reply({ error: 'DSH authentication required.' }, rejected);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return reply({ error: 'Expected JSON.' }, 415);
    // Read no more than a small code envelope, even when the carrier supports huge uploads.
    let payload: Record<string, unknown> | undefined;
    try { payload = object(JSON.parse((await boundedBody(new Response(request.body), request.signal, 12 * 1024)).toString('utf8'))); }
    catch { return reply({ error: 'Invalid code submission.' }, 400); }
    if (!payload || Object.keys(payload).some(key => !['attemptId', 'code'].includes(key)) || typeof payload.attemptId !== 'string' || !ATTEMPT_ID.test(payload.attemptId)) return reply({ error: 'Invalid code submission.' }, 400);
    try { return reply(await sessions.submitCode(payload.attemptId, payload.code, request.signal)); }
    catch (error) { return reply({ error: safeError(error) }, 400); }
  } });
  return async () => { await code(); await state(); };
}

export function mountLoginApi(ctx: Context, sessions: Sessions): void {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as unknown as LoginConnection;
    if (typeof connection?.fetch?.register !== 'function' || typeof connection.requestRejection !== 'function') throw new Error('Devin code login requires DSH authenticated Connection Fetch routes.');
    scope.effect(() => registerLoginApi(connection, sessions));
  });
}
