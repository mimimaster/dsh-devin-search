import { memo, useEffect } from 'react'
import { DevinIcon, ShieldIcon } from './icons.js'
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

export interface DevinActionCommandCardProps {
  node: CommandNode
}

export const DevinActionCommandCard = memo(function DevinActionCommandCard({ node }: DevinActionCommandCardProps) {
  const name = node.name ?? 'devin-command'
  const outcome = node.outcome
  const text = outcome?.text ?? ''
  const isRunning = outcome === null
  const isError = outcome?.kind === 'error'

  const isCancel = name === 'devin-cancel'
  const isLogout = name === 'devin-logout'

  const title = isCancel
    ? 'Devin 登录取消'
    : isLogout
      ? 'Devin 退出登录'
      : name

  // Flip frozen /devin-login "waiting" cards when cancel/logout settles.
  useEffect(() => {
    if (isRunning || isError || outcome === null) return
    const at = node.time ?? Date.now()
    if (isCancel) {
      publishDevinLiveState({ phase: 'cancelled', at })
      return
    }
    if (isLogout) {
      publishDevinLiveState({ phase: 'logged-out', at })
    }
  }, [isRunning, isError, outcome, isCancel, isLogout, node.time, text])

  if (isRunning) {
    return (
      <div className="devin-card spine-lamp" data-devin-action-card="running" data-ink-spine="lamp">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Action Dispatch</span>
          <span className="eyebrow-id">RUNNING</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>{title}</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>处理中…</span>
          </span>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="devin-card spine-crimson" data-devin-action-card={name} data-ink-spine="crimson">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · Audit Log</span>
          <span className="eyebrow-id">FAILED</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>{title}</span>
          </div>
          <span className="ink-seal seal-crimson">失败</span>
        </div>
        <div className="devin-body" style={{ color: 'var(--ink-crimson)' }}>
          {text || '操作执行未成功'}
        </div>
      </div>
    )
  }

  // Success state:
  const auditDetails = isCancel ? [
    { label: '流程状态', value: 'OAuth 本地监听已撤回并安全关闭' },
    { label: '端口释放', value: '127.0.0.1 临时回调监听已解绑' },
    { label: '凭据影响', value: '已有会话凭据未受影响（清空请用 /devin-logout）' },
  ] : [
    { label: '存储抹除', value: '已从 .credentials.yaml (0600) 彻底清除' },
    { label: '权限回收', value: 'Devin 会话 Token 已销毁' },
    { label: '能力状态', value: 'web_search / code_search 已切回无授权隔离态' },
  ]

  return (
    <div className="devin-card" data-devin-action-card={name} data-ink-spine="ghost">
      <div className="devin-card-eyebrow">
        <span className="eyebrow-scope">Devin · Audit Log</span>
        <span className="eyebrow-id">{isCancel ? 'WITHDRAWN' : 'CLEARED'}</span>
      </div>

      <div className="devin-header">
        <div className="devin-title">
          <DevinIcon size={22} />
          <span>{title}</span>
        </div>
        <span className="ink-seal seal-pine">● 已归档</span>
      </div>

      <div className="ink-ledger">
        {auditDetails.map((item, idx) => (
          <div key={idx} className="ink-ledger-row">
            <span className="ink-ledger-key">
              <ShieldIcon size={13} style={{ color: 'var(--ink-t3)' }} />
              <span>{item.label}</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-t2)' }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div className="devin-tip">
        案头注：如需重新建立 Devin 授权连接，请在输入框运行 <code>/devin-login</code>。
      </div>
    </div>
  )
})
