import { useState, useSyncExternalStore } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export interface SearchForm {
  getSnapshot(): { status: string; writable: boolean; value?: { webSearch?: boolean; codeSearch?: boolean } }
  subscribe(listener: () => void): () => void
  set(field: string, value: boolean): Promise<boolean>
}

/** Use DSH's native Switch and revision-fenced ConfigForm, never localStorage or credentials. */
export function SearchSettings({ form }: { form: SearchForm }) {
  const state = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const disabled = state.status !== 'ready' || !state.writable || saving
  const save = async (field: string, value: boolean) => {
    setSaving(true); setError('')
    try { if (!await form.set(field, value)) setError('设置未保存，请重试。') }
    catch { setError('设置未保存，请重试。') }
    finally { setSaving(false) }
  }
  return <section aria-label="搜索工具开关" style={{ maxWidth: 680 }}>
    <h3 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 8px' }}>搜索工具</h3>
    {([
      ['webSearch', '网页搜索', 'web_search · 不影响 web_fetch'],
      ['codeSearch', '代码搜索', 'code_search · 使用 DSH 原生工具界面'],
    ] as const).map(([field, title, hint]) => <div key={field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-weak)' }}>
      <div><div>{title}</div><div style={{ fontSize: 13, color: 'var(--dsw-alias-text-secondary)', marginTop: 4 }}>{hint}</div></div>
      <Switch label={title} checked={state.value?.[field] !== false} disabled={disabled} onChange={value => { void save(field, value) }} />
    </div>)}
    <p role="status" style={{ fontSize: 13, color: 'var(--dsw-alias-text-secondary)', margin: '12px 0 0' }}>{saving ? '保存中…' : '独立控制，自动保存；关闭搜索不会退出登录。'}</p>
    {error && <p role="alert">{error}</p>}
    {state.status !== 'ready' && <p role="status">正在读取插件设置…</p>}
  </section>
}
