import { useState } from 'react'
import ChatPanel from './components/ChatPanel'
import PreviewPane from './components/PreviewPane'
import CodePane from './components/CodePane'
import type { AppVersion, Message, Step } from './types'
import { fakeGenerate } from './mock'

const uid = () => Math.random().toString(36).slice(2, 9)

/** Step 1 的两步流程骨架。Step 4 会把 Plan 真正接进去 */
const INITIAL_STEPS: Step[] = [
  { id: 'plan', label: '理解需求', status: 'pending' },
  { id: 'code', label: '生成代码', status: 'pending' },
]

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), role: 'assistant', content: '你好，描述一个你想要的应用，我来帮你把它做出来。' },
  ])
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)

  const current = versions[currentIdx]

  const patchMsg = (id: string, patch: Partial<Message>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const setStep = (msgId: string, stepId: string, status: Step['status']) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, steps: m.steps?.map((s) => (s.id === stepId ? { ...s, status } : s)) }
          : m
      )
    )

  async function handleSend(text: string) {
    setBusy(true)
    setMessages((p) => [...p, { id: uid(), role: 'user', content: text }])

    const botId = uid()
    setMessages((p) => [
      ...p,
      { id: botId, role: 'assistant', content: '正在生成…', steps: INITIAL_STEPS.map((s) => ({ ...s })) },
    ])

    setStep(botId, 'plan', 'running')
    setStep(botId, 'code', 'pending')

    // ---- Step 2 会把这里换成真实 LLM 调用 ----
    const code = await fakeGenerate(text)
    setStep(botId, 'plan', 'done')
    setStep(botId, 'code', 'running')

    setVersions((p) => [...p, { id: uid(), prompt: text, code, createdAt: Date.now() }])
    setCurrentIdx((i) => i + 1)
    setReloadKey((k) => k + 1)
    setStep(botId, 'code', 'done')
    patchMsg(botId, { content: `已生成，共 ${code.length} 字符。` })
    setBusy(false)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Atoms<span>·</span>Demo
        </div>
        <div className="spacer" />
        <div className="segmented">
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>
            预览
          </button>
          <button className={view === 'code' ? 'on' : ''} onClick={() => setView('code')}>
            代码
          </button>
        </div>
        <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)}>
          刷新
        </button>
      </div>

      <div className="main">
        <ChatPanel messages={messages} busy={busy} onSend={handleSend} />
        {view === 'preview' ? (
          <PreviewPane code={current?.code ?? ''} reloadKey={reloadKey} />
        ) : (
          <CodePane code={current?.code ?? ''} />
        )}
      </div>
    </div>
  )
}
