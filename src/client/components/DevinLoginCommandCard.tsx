import { memo, useCallback, useEffect, useId, useState } from 'react'
import { DevinIcon, ExternalLinkIcon, CopyIcon, CheckIcon, ShieldIcon } from './icons.js'
import { deriveLoginCardModel, AUTH_URL_REGEX } from '../login-card-model.js'
import {
  getDevinLiveState,
  subscribeDevinLiveState,
  type DevinLiveState,
} from '../login-live-state.js'
import { publishLoginState, startLoginApiPoll, submitLoginCode } from '../login-api.js'
import type { LoginState } from '../../login-state.js'

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

export interface DevinLoginCommandCardProps {
  node: CommandNode
}

function useDevinLiveState(): DevinLiveState {
  const [live, setLive] = useState(getDevinLiveState)
  useEffect(() => subscribeDevinLiveState(() => { setLive(getDevinLiveState()) }), [])
  return live
}

export const DevinLoginCommandCard = memo(function DevinLoginCommandCard({ node }: DevinLoginCommandCardProps) {
  const [copied, setCopied] = useState(false)
  const live = useDevinLiveState()
  const [remote, setRemote] = useState<LoginState>()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')
  const codeId = useId()
  const baseModel = deriveLoginCardModel(node.outcome, live, { commandTime: node.time ?? 0 })
  const model = baseModel.kind === 'waiting' && remote?.phase === 'error'
    ? { kind: 'error' as const, text: remote.detail ?? '授权失败，请重新执行 /devin-login。' }
    : baseModel
  const attemptId = baseModel.kind === 'waiting' ? baseModel.attemptId : undefined

  const authUrl = model.kind === 'waiting'
    ? model.authUrl
    : (node.outcome?.text ?? '').match(AUTH_URL_REGEX)?.[1]

  // Status stays on the authenticated DSH connection, even if the browser is on a phone.
  useEffect(() => {
    if (model.kind !== 'waiting' || !attemptId) return
    return startLoginApiPoll(attemptId, state => { setRemote(state); setApiError('') }, setApiError)
  }, [model.kind, attemptId])

  useEffect(() => { if (model.kind !== 'waiting') setCode('') }, [model.kind])

  const handleSubmitCode = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!attemptId || submitting || !code.trim()) return
    setSubmitting(true); setApiError('')
    // Clear the field before sending; never persist the code or send it as a chat command.
    const entered = code.trim(); setCode('')
    try {
      const state = await submitLoginCode(attemptId, entered)
      setRemote(state); publishLoginState(state)
    } catch {
      setApiError('提交未确认，请检查登录状态；如仍在等待，可重新粘贴授权码。')
    } finally { setSubmitting(false) }
  }

  const handleOpenBrowser = useCallback(() => {
    if (authUrl) window.open(authUrl, '_blank', 'noopener,noreferrer')
  }, [authUrl])

  const handleCopyLink = useCallback(async () => {
    if (!authUrl) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(authUrl)
      } else {
        const input = document.createElement('textarea')
        input.value = authUrl
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures
    }
  }, [authUrl])

  if (model.kind === 'running') {
    return (
      <div className="devin-card spine-lamp" data-devin-login-card="running" data-ink-spine="lamp">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">AWAITING BROWSER</span>
        </div>

        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 登录授权</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>正在准备授权链接…</span>
          </span>
        </div>

        <div className="ink-ledger">
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-pine)' }}>①</span>
              <span>安全授权流程</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-pine)' }}>
              正在创建当前登录请求
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-lamp)' }}>②</span>
              <span>浏览器账户授权</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-lamp)' }}>
              链接就绪后请点击授权按钮
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-t4)' }}>③</span>
              <span>交换凭据并保存</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-t3)' }}>
              授权完成后由服务器安全保存
            </span>
          </div>
        </div>

        <div className="devin-tip">
          正在准备授权链接，不会在服务器上尝试打开浏览器。
        </div>
      </div>
    )
  }

  if (model.kind === 'error') {
    return (
      <div className="devin-card spine-crimson" data-devin-login-card="error" data-ink-spine="crimson">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">ERROR</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 登录失败</span>
          </div>
          <span className="ink-seal seal-crimson">错误</span>
        </div>
        <div className="devin-body" style={{ color: 'var(--ink-crimson)' }}>
          {model.text}
        </div>
      </div>
    )
  }

  if (model.kind === 'saved') {
    return (
      <div className="devin-card spine-pine" data-devin-login-card="saved" data-ink-spine="pine">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">COMMITTED</span>
        </div>

        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 登录成功</span>
          </div>
          <span className="ink-seal seal-pine">● 已完成 · 凭据已封存</span>
        </div>

        <div className="ink-ledger">
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <ShieldIcon size={13} style={{ color: 'var(--ink-pine)' }} />
              <span>验证状态</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-pine)' }}>
              已通过 OAuth PKCE 安全握手
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span>凭据落盘</span>
            </span>
            <span className="ink-ledger-val">
              DSH 隔离凭据库 (0600)
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span>就绪工具</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-t1)' }}>
              <code>web_search</code> · <code>code_search</code>
            </span>
          </div>
        </div>

        {model.detail ? (
          <div className="devin-tip">{model.detail}</div>
        ) : null}
      </div>
    )
  }

  if (model.kind === 'cancelled') {
    return (
      <div className="devin-card" data-devin-login-card="cancelled" data-ink-spine="ghost">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">CANCELLED</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 登录已取消</span>
          </div>
          <span className="ink-seal seal-ghost">已取消</span>
        </div>
        <div className="devin-body">{model.text}</div>
      </div>
    )
  }

  if (model.kind === 'duplicate-pending') {
    return (
      <div className="devin-card spine-lamp" data-devin-login-card="duplicate" data-ink-spine="lamp">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">IN FLIGHT</span>
        </div>
        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>Devin 登录授权</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>进行中</span>
          </span>
        </div>
        <div className="devin-body">
          已有正在等待中的授权流程。请在之前打开的浏览器窗口中完成登录，或输入 <code>/devin-cancel</code> 取消现有请求。
        </div>
      </div>
    )
  }

  if (model.kind === 'waiting') {
    return (
      <div className="devin-card spine-zhu" data-devin-login-card="waiting" data-ink-spine="zhu">
        <div className="devin-card-eyebrow">
          <span className="eyebrow-scope">Devin · OAuth Gateway</span>
          <span className="eyebrow-id">ACTION REQUIRED</span>
        </div>

        <div className="devin-header">
          <div className="devin-title">
            <DevinIcon size={22} />
            <span>{model.mode === 'code' ? 'Devin 授权码登录' : 'Devin 浏览器鉴权'}</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>等待授权</span>
          </span>
        </div>

        <div className="devin-body">
          {model.mode === 'code' ? '点击下方按钮，在 Devin 页面完成授权后复制一次性授权码，回到这里粘贴。服务器会安全保存凭据，授权码不会进入聊天记录。' : '请在运行 DSH 的同一台设备上打开授权页。本机回调完成后，服务器保存凭据并同步状态。'}
        </div>

        <div className="devin-actions">
          <button
            type="button"
            className="devin-btn devin-btn-primary devin-btn-zhu"
            onClick={handleOpenBrowser}
          >
            <ExternalLinkIcon size={13} />
            在浏览器中打开授权
          </button>
          <button
            type="button"
            className="devin-btn devin-btn-outline"
            onClick={handleCopyLink}
          >
            {copied ? (
              <CheckIcon size={13} style={{ color: 'var(--ink-pine)' }} />
            ) : (
              <CopyIcon size={13} />
            )}
            {copied ? '已复制到剪贴板' : '复制授权链接'}
          </button>
        </div>

        <div className="ink-trough">
          <div className="ink-trough-header">
            <span>AUTHORIZATION URL</span>
            <span>CLICK TO SELECT</span>
          </div>
          <div className="devin-url-box" title="点击可全选">
            {model.authUrl}
          </div>
        </div>

        {model.mode === 'code' && attemptId ? (
          <form className="devin-code-form" onSubmit={handleSubmitCode}>
            <label htmlFor={codeId}>一次性授权码</label>
            <input id={codeId} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={code} onChange={event => setCode(event.target.value)} maxLength={8192}
              disabled={submitting || remote?.phase === 'exchanging' || remote?.phase === 'cancelled'}
              placeholder="粘贴 Devin 页面显示的授权码" aria-describedby={`${codeId}-help`} />
            <div id={`${codeId}-help`} className="devin-tip">授权码仅可使用一次，官方提示 5 分钟内有效。请勿粘贴会话 token。</div>
            <button type="submit" className="devin-btn devin-btn-primary" disabled={!code.trim() || submitting || remote?.phase === 'exchanging' || remote?.phase === 'cancelled'}>
              {submitting || remote?.phase === 'exchanging' ? '正在验证并保存…' : '提交授权码'}
            </button>
          </form>
        ) : null}
        {apiError ? <div role="alert" className="devin-tip">{apiError}</div> : null}
        <div className="devin-tip" aria-live="polite">
          {attemptId ? '登录状态通过 DSH 安全连接同步；取消请执行 /devin-cancel。' : '这是旧版登录卡片，请取消后重新执行 /devin-login。'}
        </div>
      </div>
    )
  }

  return (
    <div className="devin-card" data-devin-login-card="plain" data-ink-spine="ghost">
      <div className="devin-card-eyebrow">
        <span className="eyebrow-scope">Devin · OAuth Gateway</span>
        <span className="eyebrow-id">STANDBY</span>
      </div>
      <div className="devin-header">
        <div className="devin-title">
          <DevinIcon size={22} />
          <span>Devin 登录</span>
        </div>
      </div>
      <div className="devin-body">{model.text || '已完成'}</div>
    </div>
  )
})
