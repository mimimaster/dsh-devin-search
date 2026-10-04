import type { DevinLiveState } from './login-live-state.js'

export const AUTH_URL_REGEX = /(https:\/\/app\.devin\.ai\/auth\/cli\/continue[^\s\n]+)/

export type LoginCardModel =
  | { readonly kind: 'running' }
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'duplicate-pending' }
  | { readonly kind: 'waiting'; readonly authUrl: string }
  | { readonly kind: 'saved'; readonly detail?: string }
  | { readonly kind: 'cancelled'; readonly text: string }
  | { readonly kind: 'plain'; readonly text: string }

export type LoginOutcome = {
  readonly kind: 'success' | 'error'
  readonly text?: string
} | null

/**
 * Derive the login card face from durable command text + live cross-card state.
 * Live `authorized` wins over a frozen "Open this URL" row once status (or a
 * later success) has confirmed the grant.
 */
export function deriveLoginCardModel(
  outcome: LoginOutcome,
  live: DevinLiveState,
  options: { readonly commandTime?: number } = {},
): LoginCardModel {
  if (outcome === null) return { kind: 'running' }
  const text = outcome.text ?? ''
  if (outcome.kind === 'error') return { kind: 'error', text: text || '执行 /devin-login 发生未知异常' }

  const lower = text.toLowerCase()
  if (lower.includes('login cancelled') || lower.includes('login was withdrawn')) {
    return { kind: 'cancelled', text: text || 'Login cancelled.' }
  }
  if (
    lower.includes('login saved')
    || lower.includes('already logged in')
    || (lower.includes('logged in') && !lower.includes('not logged in') && !lower.includes('open this url'))
  ) {
    return { kind: 'saved', detail: text }
  }
  if (text.includes('Login already pending')) return { kind: 'duplicate-pending' }

  const authUrlMatch = text.match(AUTH_URL_REGEX)
  const authUrl = authUrlMatch?.[1]
  const commandTime = options.commandTime ?? 0
  const liveIsNewer = live.at >= commandTime
  const liveConfirmsAuth = live.phase === 'authorized' && liveIsNewer
  const liveConfirmsCancel = (live.phase === 'cancelled' || live.phase === 'logged-out') && liveIsNewer

  // Frozen URL rows: later cancel/logout or status must flip them off "waiting".
  if (authUrl) {
    if (liveConfirmsAuth) {
      return {
        kind: 'saved',
        detail: live.expiresAt ? `有效期至 ${live.expiresAt}` : '凭据已写入 DSH 存储',
      }
    }
    if (liveConfirmsCancel) {
      return {
        kind: 'cancelled',
        text: live.phase === 'logged-out'
          ? '已退出登录；此前的授权等待已关闭。'
          : '登录等待已取消。',
      }
    }
    return { kind: 'waiting', authUrl }
  }

  if (liveConfirmsAuth && (lower.includes('open this url') || lower.includes('login pending'))) {
    return {
      kind: 'saved',
      detail: live.expiresAt ? `有效期至 ${live.expiresAt}` : '凭据已写入 DSH 存储',
    }
  }
  if (liveConfirmsCancel && (lower.includes('open this url') || lower.includes('login pending'))) {
    return { kind: 'cancelled', text: '登录等待已取消。' }
  }
  if (!text) return { kind: 'plain', text: '' }
  return { kind: 'plain', text }
}
