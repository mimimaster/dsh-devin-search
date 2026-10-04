import { publishDevinLiveState } from './login-live-state.js'

/** Build the loopback /status URL from a Devin auth continue link. */
export function statusUrlFromAuthUrl(authUrl: string): string | null {
  try {
    const continueUrl = new URL(authUrl)
    const redirect = continueUrl.searchParams.get('redirect_uri')
    if (!redirect) return null
    const callback = new URL(redirect)
    if (callback.hostname !== '127.0.0.1' && callback.hostname !== 'localhost') return null
    if (callback.protocol !== 'http:' && callback.protocol !== 'https:') return null
    return `${callback.protocol}//${callback.host}/status`
  } catch {
    return null
  }
}

export type PolledPhase = 'pending' | 'authorized' | 'cancelled' | 'error'

/** Parse a /status JSON body; unknown shapes are ignored. */
export function parseStatusPayload(value: unknown): PolledPhase | null {
  if (!value || typeof value !== 'object') return null
  const phase = (value as { phase?: unknown }).phase
  if (phase === 'pending' || phase === 'authorized' || phase === 'cancelled' || phase === 'error') {
    return phase
  }
  return null
}

/**
 * Poll loopback /status while a login card is waiting. Publishes live state on
 * terminal phases so the frozen command row can flip without /devin-status.
 */
export function startLoginStatusPoll(
  authUrl: string,
  options: {
    readonly intervalMs?: number
    readonly now?: () => number
    readonly fetchImpl?: typeof fetch
  } = {},
): () => void {
  const endpoint = statusUrlFromAuthUrl(authUrl)
  if (endpoint === null) return () => {}

  const intervalMs = options.intervalMs ?? 800
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch
  let stopped = false
  let inFlight = false

  const apply = (phase: PolledPhase): void => {
    if (phase === 'pending' || stopped) return
    if (phase === 'authorized') {
      publishDevinLiveState({ phase: 'authorized', at: now() })
    } else {
      // cancelled | error → waiting card shows cancelled
      publishDevinLiveState({ phase: 'cancelled', at: now() })
    }
    stopped = true
  }

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
      })
      if (stopped || !response.ok) return
      const phase = parseStatusPayload(await response.json())
      if (phase !== null) apply(phase)
    } catch {
      // Server not ready yet, or already closed after hold — keep trying until unmount.
    } finally {
      inFlight = false
    }
  }

  void tick()
  const timer = setInterval(() => { void tick() }, intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
