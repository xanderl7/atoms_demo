import { useState } from 'react'
import ChatPanel from './components/ChatPanel'
import PreviewPane from './components/PreviewPane'
import CodePane from './components/CodePane'
import Settings from './components/Settings'
import type { AppVersion, Message, Step } from './types'
import { loadConfig, saveConfig, type LLMConfig } from './config'
import { chat } from './llm'
import { SYSTEM_PLAN, buildCodeMessages, extractHtml } from './prompts'

const uid = () => Math.random().toString(36).slice(2, 9)

const INITIAL_STEPS: Step[] = [
  { id: 'plan', label: '理解需求', status: 'pending' },
  { id: 'code', label: '生成代码', status: 'pending' },
]

export default function App() {
  const [cfg, setCfg] = useState<LLMConfig>(loadConfig)
  const [showSettings, setShowSettings] = useState(false)
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

    // 没填 Key：把用户的话照常显示出来，再提示去填 —— 不能让人以为消息发丢了
    if (!cfg.apiKey) {
      setShowSettings(true)
      setMessages((p) => [
        ...p,
        { id: uid(), role: 'assistant', content: '请先在右上角 ⚙︎ 里填写 API Key，然后重新发送。' },
      ])
      setBusy(false)
      return
    }

    const botId = uid()
    setMessages((p) => [
      ...p,
      {
        id: botId,
        role: 'assistant',
        content: '',
        steps: INITIAL_STEPS.map((s) => ({ ...s })),
      },
    ])

    try {
      // Step 1: 拆解需求
      setStep(botId, 'plan', 'running')
      const plan = await chat(cfg, [
        { role: 'system', content: SYSTEM_PLAN },
        { role: 'user', content: text },
      ], 0.3)
      setStep(botId, 'plan', 'done')
      patchMsg(botId, { content: plan })

      // Step 2: 生成代码（带上上一版 —— 天然支持多轮迭代）
      setStep(botId, 'code', 'running')
      const raw = await chat(cfg, buildCodeMessages(text, plan, current?.code ?? null))
      const code = extractHtml(raw)

      setVersions((p) => [...p, { id: uid(), prompt: text, plan, code, createdAt: Date.now() }])
      setCurrentIdx((i) => i + 1)
      setReloadKey((k) => k + 1)
      setStep(botId, 'code', 'done')
      patchMsg(botId, { content: `${plan}\n\n已生成 ${code.length} 字符，右侧可预览。` })
    } catch (e: any) {
      setMessages((p) =>
        p.map((m) =>
          m.id === botId
            ? { ...m, content: `生成失败：${e.message}`, steps: m.steps?.map((s) => ({ ...s, status: 'error' })) }
            : m
        )
      )
    } finally {
      setBusy(false)
    }
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
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="模型设置">
          ⚙︎
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

      {showSettings && (
        <Settings
          value={cfg}
          onSave={(c) => {
            setCfg(c)
            saveConfig(c)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
