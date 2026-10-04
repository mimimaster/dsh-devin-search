import { memo, useEffect, useMemo } from 'react'
import { DevinIcon, KeyIcon, GlobeIcon, CodeIcon, ShieldIcon, ClockIcon } from './icons.js'
import { publishDevinLiveState } from '../login-live-state.js'

interface CommandNode {
  kind: 'command'
  commandId: string
  name: string | null
  args: string | null
  time?: number
  outcome: {
    kind: 'success' | 'error'
    text?: string
  } | null
}

export interface DevinStatusCommandCardProps {
  node: CommandNode
}

export const DevinStatusCommandCard = memo(function DevinStatusCommandCard({ node }: DevinStatusCommandCardProps) {
  const outcome = node.outcome
  const text = outcome?.text ?? ''
  const isRunning = outcome === null
  const isError = outcome?.kind === 'error'

  const isLoggedIn = useMemo(() => {
    return text.toLowerCase().includes('logged in') && !text.toLowerCase().includes('not logged in')
  }, [text])

  const isPending = useMemo(() => text.toLowerCase().includes('login pending'), [text])

  const expiresAt = useMemo(() => {
    const match = text.match(/Expires\s+([0-9TZ:.-]+)/)
    if (!match || !match[1]) return null
    try {
      const d = new Date(match[1])
      return isNaN(d.getTime()) ? match[1] : d.toLocaleString()
    } catch {
      return match[1]
    }
  }, [text])

  // Publish live phase so a frozen /devin-login "waiting" card can flip to success.
  useEffect(() => {
    if (isRunning || isError || outcome === null) return
    const at = node.time ?? Date.now()
    if (isLoggedIn) {
      publishDevinLiveState({
        phase: 'authorized',
        at,
        ...(expiresAt ? { expiresAt } : {}),
      })
      return
    }
    if (isPending) {
      publishDevinLiveState({ phase: 'pending', at })
      return
    }
    publishDevinLiveState({ phase: 'logged-out', at })
  }, [isRunning, isError, isLoggedIn, isPending, expiresAt, outcome, node.time, text])

  if (isRunning) {
    return (
      <div className="devin-card spine-lamp" data-ink-spine="lamp">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Session Status</span>
          <span className="eyebrow-id">CHECKING</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 会话状态</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>查询中…</span>
          </span>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="devin-card spine-crimson" data-ink-spine="crimson">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Session Status</span>
          <span className="eyebrow-id">ERROR</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 会话状态</span>
          </div>
          <span className="ink-seal seal-crimson">查询失败</span>
        </div>
        <div className="devin-body" style={{ color: 'var(--ink-crimson)' }}>
          {text || '执行 /devin-status 遇到异常'}
        </div>
      </div>
    )
  }

  if (isLoggedIn) {
    return (
      <div className="devin-card spine-pine" data-ink-spine="pine">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Session Ledger</span>
          <span className="eyebrow-id">ACTIVE · GRANTED</span>
        </div>

        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 会话状态</span>
          </div>
          <span className="ink-seal seal-pine">● 已连接 (Active)</span>
        </div>

        {/* 墨石账册台面 */}
        <div className="ink-ledger">
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <ShieldIcon size={13} style={{ color: 'var(--ink-pine)' }} />
              <span>授权凭据</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-pine)' }}>
              有效会话 · 已通过鉴权
            </span>
          </div>

          {expiresAt && (
            <div className="ink-ledger-row">
              <span className="ink-ledger-key">
                <ClockIcon size={13} style={{ color: 'var(--ink-t3)' }} />
                <span>有效期至</span>
              </span>
              <span className="ink-ledger-val">
                {expiresAt}
              </span>
            </div>
          )}

          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <CodeIcon size={13} style={{ color: 'var(--ink-t3)' }} />
              <span>生效能力</span>
            </span>
            <div className="ink-ledger-val">
              <span className="ink-chip">
                <span className="chip-dot" />
                <GlobeIcon size={11} />
                <span>web_search</span>
              </span>
              <span className="ink-chip">
                <span className="chip-dot" />
                <CodeIcon size={11} />
                <span>code_search</span>
              </span>
            </div>
          </div>

          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <KeyIcon size={13} style={{ color: 'var(--ink-t3)' }} />
              <span>凭据存储</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-t2)' }}>
              DSH 本地隔离加密库 (0600)
            </span>
          </div>
        </div>

        <div className="devin-tip">
          案头注：如需轮换凭据或清理本地会话，可在输入框执行 <code>/devin-logout</code>。
        </div>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="devin-card spine-lamp" data-ink-spine="lamp">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Session Ledger</span>
          <span className="eyebrow-id">PENDING AUTH</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 会话状态</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>等待授权</span>
          </span>
        </div>
        <div className="devin-body">
          检测到后台有正在等待浏览器授权的请求。如需终止等待，可执行 <code>/devin-cancel</code>。
        </div>
      </div>
    )
  }

  return (
    <div className="devin-card" data-ink-spine="ghost">
      <div className="devin-card-eyebrow">
        <span className="eyebrow-scope">Devin · Session Ledger</span>
        <span className="eyebrow-id">DISCONNECTED</span>
      </div>
      <div className="devin-header">
        <div className="devin-title">
          <DevinIcon size={22} />
          <span>Devin 会话状态</span>
        </div>
        <span className="ink-seal seal-ghost">未连接</span>
      </div>
      <div className="devin-body">
        {text || '当前未检测到有效的 Devin 登录凭据。'}
      </div>
      <div className="devin-tip">
        提示：在聊天框输入 <code>/devin-login</code> 即可启动浏览器授权。
      </div>
    </div>
  )
})
