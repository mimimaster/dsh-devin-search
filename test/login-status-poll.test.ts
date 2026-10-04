import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  parseStatusPayload,
  startLoginStatusPoll,
  statusUrlFromAuthUrl,
} from '../src/client/login-status-poll.js'
import {
  getDevinLiveState,
  resetDevinLiveState,
} from '../src/client/login-live-state.js'

const AUTH = 'https://app.devin.ai/auth/cli/continue?state=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A59653%2Fcallback&code_challenge=y&code_challenge_method=S256'

describe('login status poll helpers', () => {
  beforeEach(() => { resetDevinLiveState() })

  it('derives loopback /status from auth continue URL', () => {
    expect(statusUrlFromAuthUrl(AUTH)).toBe('http://127.0.0.1:59653/status')
    expect(statusUrlFromAuthUrl('https://evil.example/x')).toBeNull()
  })

  it('parses status payload phases', () => {
    expect(parseStatusPayload({ phase: 'authorized' })).toBe('authorized')
    expect(parseStatusPayload({ phase: 'nope' })).toBeNull()
    expect(parseStatusPayload(null)).toBeNull()
  })

  it('publishes authorized when /status becomes terminal', async () => {
    let phase = 'pending'
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ phase }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const stop = startLoginStatusPoll(AUTH, {
      intervalMs: 20,
      now: () => 1_700_000_000_123,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(getDevinLiveState().phase).toBe('unknown')
    phase = 'authorized'
    await vi.waitFor(() => expect(getDevinLiveState()).toEqual({
      phase: 'authorized',
      at: 1_700_000_000_123,
    }))
    stop()
  })
})
