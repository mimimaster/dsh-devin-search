import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { DevinLoginCommandCard, type DevinLoginCommandCardProps } from '../../src/client/components/DevinLoginCommandCard.js'
import { injectDevinStyles } from '../../src/client/styles/devin-theme.js'
import { resetDevinLiveState } from '../../src/client/login-live-state.js'
injectDevinStyles()
function Preview() {
  const [node, setNode] = useState<DevinLoginCommandCardProps['node']>()
  const [error, setError] = useState('')
  const start = async () => {
    resetDevinLiveState(); setNode(undefined); setError('')
    try {
      const response = await fetch('/fixture/start', { method: 'POST', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Fixture start failed')
      setNode(await response.json())
    } catch { setError('隔离测试服务启动失败。') }
  }
  useEffect(() => { void start() }, [])
  return <main style={{ width: '100%', maxWidth: 700, margin: '0 auto', padding: 16, boxSizing: 'border-box' }}>
    <h1 style={{ fontSize: 20 }}>远程 Devin 登录隔离测试</h1>
    <p>模拟提供方；测试码：<code>fixture-preview-code</code>。不使用真实账号或凭据。</p>
    <button onClick={() => { void start() }} style={{ minHeight: 44 }}>重新开始测试</button>
    {error ? <p role="alert">{error}</p> : null}
    {node ? <DevinLoginCommandCard key={node.commandId} node={node} /> : <p>正在创建登录请求…</p>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
