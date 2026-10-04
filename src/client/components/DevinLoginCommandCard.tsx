import { memo, useCallback, useEffect, useState } from 'react'
import { DevinIcon, ExternalLinkIcon, CopyIcon, CheckIcon, ShieldIcon } from './icons.js'
import { deriveLoginCardModel, AUTH_URL_REGEX } from '../login-card-model.js'
import {
  getDevinLiveState,
  subscribeDevinLiveState,
  type DevinLiveState,
} from '../login-live-state.js'
import { startLoginStatusPoll } from '../login-status-poll.js'

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
  const model = deriveLoginCardModel(node.outcome, live, { commandTime: node.time ?? 0 })

  const authUrl = model.kind === 'waiting'
    ? model.authUrl
    : (node.outcome?.text ?? '').match(AUTH_URL_REGEX)?.[1]

  // Real-time: poll loopback /status while this row is still waiting.
  useEffect(() => {
    if (model.kind !== 'waiting' || !authUrl) return
    return startLoginStatusPoll(authUrl)
  }, [model.kind, authUrl])

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
            <span>等待浏览器授权…</span>
          </span>
        </div>

        <div className="ink-ledger">
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-pine)' }}>①</span>
              <span>本地安全回调</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-pine)' }}>
              127.0.0.1 临时端口已绑定监听
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-lamp)' }}>②</span>
              <span>浏览器账户授权</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-lamp)' }}>
              已尝试自动打开浏览器，等待点击允许
            </span>
          </div>
          <div className="ink-ledger-row">
            <span className="ink-ledger-key">
              <span style={{ color: 'var(--ink-t4)' }}>③</span>
              <span>交换凭据并保存</span>
            </span>
            <span className="ink-ledger-val" style={{ color: 'var(--ink-t3)' }}>
              等待授权回调触发
            </span>
          </div>
        </div>

        <div className="devin-tip">
          案头注：请在打开的 Devin 页面完成登录；成功后本卡片会自动翻面归档。若未自动打开浏览器，可输入 <code>/devin-cancel</code> 重试。
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
            <span>Devin 浏览器鉴权</span>
          </div>
          <span className="ink-seal seal-lamp">
            <span className="ink-grind" />
            <span>等待授权</span>
          </span>
        </div>

        <div className="devin-body">
          请在浏览器中完成账户授权。授权完成后本地服务将自动交换并保存凭据，本卡片会自动完成同步。
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

        <div className="devin-tip">
          正在监听本地回调端口… 浏览器完成授权后无需手动刷新，卡片将在 1 秒内自动归档。
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
