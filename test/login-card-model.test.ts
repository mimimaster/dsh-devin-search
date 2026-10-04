import { describe, expect, it, beforeEach } from 'vitest'
import { deriveLoginCardModel } from '../src/client/login-card-model.js'
import {
  getDevinLiveState,
  publishDevinLiveState,
  resetDevinLiveState,
  subscribeDevinLiveState,
} from '../src/client/login-live-state.js'

const URL = 'https://app.devin.ai/auth/cli/continue?state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcallback&code_challenge=x&code_challenge_method=S256'

describe('login live state', () => {
  beforeEach(() => { resetDevinLiveState() })

  it('ignores older publications and notifies subscribers', () => {
    const seen: string[] = []
    const stop = subscribeDevinLiveState(() => { seen.push(getDevinLiveState().phase) })
    publishDevinLiveState({ phase: 'authorized', at: 100, expiresAt: 'soon' })
    publishDevinLiveState({ phase: 'logged-out', at: 50 })
    expect(getDevinLiveState()).toEqual({ phase: 'authorized', at: 100, expiresAt: 'soon' })
    publishDevinLiveState({ phase: 'logged-out', at: 200 })
    expect(getDevinLiveState().phase).toBe('logged-out')
    expect(seen).toEqual(['authorized', 'logged-out'])
    stop()
  })
})

describe('deriveLoginCardModel', () => {
  beforeEach(() => { resetDevinLiveState() })

  it('keeps frozen URL rows waiting until live auth confirms', () => {
    expect(deriveLoginCardModel(
      { kind: 'success', text: `Open this URL to log in: ${URL}` },
      { phase: 'unknown', at: 0 },
      { commandTime: 10 },
    )).toEqual({ kind: 'waiting', authUrl: URL })

    expect(deriveLoginCardModel(
      { kind: 'success', text: `Open this URL to log in: ${URL}` },
      { phase: 'authorized', at: 5, expiresAt: '2026-10-05' },
      { commandTime: 10 },
    )).toEqual({ kind: 'waiting', authUrl: URL })

    expect(deriveLoginCardModel(
      { kind: 'success', text: `Open this URL to log in: ${URL}` },
      { phase: 'authorized', at: 20, expiresAt: '2026-10-05' },
      { commandTime: 10 },
    )).toEqual({ kind: 'saved', detail: '有效期至 2026-10-05' })
  })

  it('recognizes durable success and cancel texts without live state', () => {
    expect(deriveLoginCardModel(
      { kind: 'success', text: 'Login saved.' },
      { phase: 'unknown', at: 0 },
    )).toEqual({ kind: 'saved', detail: 'Login saved.' })
    expect(deriveLoginCardModel(
      { kind: 'success', text: 'Login cancelled.' },
      { phase: 'unknown', at: 0 },
    )).toEqual({ kind: 'cancelled', text: 'Login cancelled.' })
    expect(deriveLoginCardModel(
      { kind: 'success', text: 'Login already pending; use /devin-status or /devin-cancel.' },
      { phase: 'unknown', at: 0 },
    )).toEqual({ kind: 'duplicate-pending' })
  })

  it('flips frozen URL rows to cancelled after a newer cancel/logout', () => {
    const waiting = { kind: 'success' as const, text: `Open this URL to log in: ${URL}` }
    expect(deriveLoginCardModel(waiting, { phase: 'cancelled', at: 5 }, { commandTime: 10 }))
      .toEqual({ kind: 'waiting', authUrl: URL })
    expect(deriveLoginCardModel(waiting, { phase: 'cancelled', at: 20 }, { commandTime: 10 }))
      .toEqual({ kind: 'cancelled', text: '登录等待已取消。' })
    expect(deriveLoginCardModel(waiting, { phase: 'logged-out', at: 20 }, { commandTime: 10 }))
      .toEqual({ kind: 'cancelled', text: '已退出登录；此前的授权等待已关闭。' })
  })
})
