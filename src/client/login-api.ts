import { ATTEMPT_ID, LOGIN_CODE_PATH, LOGIN_STATE_PATH, type LoginState } from '../login-state.js'
import { publishDevinLiveState } from './login-live-state.js'

export class LoginApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export function parseLoginState(value: unknown, attemptId: string): LoginState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<LoginState>
  if (state.attemptId !== attemptId || !ATTEMPT_ID.test(attemptId) || !['code', 'loopback'].includes(state.mode ?? '') || !['pending', 'exchanging', 'authorized', 'cancelled', 'error'].includes(state.phase ?? '')) return null
  return { attemptId, mode: state.mode!, phase: state.phase!, ...(typeof state.detail === 'string' ? { detail: state.detail } : {}) }
}
async function read(response: Response, attemptId: string): Promise<LoginState> {
  if (!response.ok) throw new LoginApiError(response.status, response.status === 401 || response.status === 403 ? 'DSH 连接未授权，请重新连接。' : response.status === 404 ? '登录请求已过期或被替换，请重新执行 /devin-login。' : '授权码提交失败，请检查登录状态后重试。')
  const state = parseLoginState(await response.json(), attemptId)
  if (!state) throw new Error('DSH 返回了无效登录状态。')
  return state
}
export function publishLoginState(state: LoginState, now = Date.now()): void {
  if (state.phase === 'authorized' || state.phase === 'cancelled') publishDevinLiveState({ phase: state.phase, at: now, attemptId: state.attemptId })
}
export async function submitLoginCode(attemptId: string, code: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<LoginState> {
  const response = await fetcher(LOGIN_CODE_PATH, {
    method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attemptId, code }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(45_000)]),
  })
  return read(response, attemptId)
}
/** All new cards use the authenticated DSH API, including local callback mode. Never fetch phone localhost. */
export function startLoginApiPoll(attemptId: string, onState: (state: LoginState) => void, onError: (message: string) => void, options: { intervalMs?: number; fetcher?: typeof fetch } = {}): () => void {
  const controller = new AbortController()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    try {
      const response = await (options.fetcher ?? fetch)(`${LOGIN_STATE_PATH}?attemptId=${encodeURIComponent(attemptId)}`, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
      const state = await read(response, attemptId)
      if (stopped) return
      onState(state)
      publishLoginState(state)
      if (!['pending', 'exchanging'].includes(state.phase)) stopped = true
    } catch (error) {
      if (stopped) return
      if (error instanceof LoginApiError && [401, 403, 404].includes(error.status)) { stopped = true; onError(error.message) }
      else onError('暂时无法同步登录状态；连接恢复后会重试。')
    } finally {
      if (!stopped) timer = setTimeout(() => { void tick() }, options.intervalMs ?? 800)
    }
  }
  void tick()
  return () => { stopped = true; clearTimeout(timer); controller.abort() }
}
