import { useEffect, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import PreviewPane from './components/PreviewPane'
import CodePane from './components/CodePane'
import Settings from './components/Settings'
import type { AppVersion, Message, Step } from './types'
import { loadConfig, saveConfig, type LLMConfig } from './config'
import { chat } from './llm'
import { SYSTEM_ROUTER, parseRouter, buildCodeMessages, extractHtml } from './prompts'

const uid = () => Math.random().toString(36).slice(2, 9)

const STEP_LABELS = [
  { id: 'route', label: '判断意图' },
  { id: 'plan', label: '拆解需求' },
  { id: 'code', label: '生成代码' },
]

const mkSteps = (): Step[] => STEP_LABELS.map((s) => ({ ...s, status: 'pending' }))
const onlyStep = (id: string, label: string, status: Step['status']): Step[] => [
  { id, label, status },
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
  const [elapsed, setElapsed] = useState(0)

  // 生成时每秒 +1，让人看到「在跑」而不是「卡住」
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

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
    const t0 = Date.now() // 闭包里的 elapsed 是旧值，必须用时间戳自己算
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
      { id: botId, role: 'assistant', content: '', steps: mkSteps() },
    ])

    try {
      // Step 1: 判意图 + 拆需求（合并成一次调用，省 2-3 秒）
      setStep(botId, 'route', 'running')
      const raw = await chat(
        cfg,
        [
          { role: 'system', content: SYSTEM_ROUTER },
          { role: 'user', content: text },
        ],
        0.2
      )
      const r = parseRouter(raw)
      setStep(botId, 'route', 'done')

      // 只是聊天：回一句话就结束，不碰代码
      if (r.intent === 'chat') {
        patchMsg(botId, {
          content: r.reply || '你好！描述一个你想要的应用，我来帮你做出来。',
          steps: onlyStep('route', '判断意图', 'done'),
        })
        setBusy(false)
        return
      }

      setStep(botId, 'plan', 'running')
      setStep(botId, 'plan', 'done')
      patchMsg(botId, { content: r.plan })

      // Step 2: 生成代码（带上上一版 —— 天然支持多轮迭代）
      setStep(botId, 'code', 'running')
      const rawCode = await chat(cfg, buildCodeMessages(text, r.plan, current?.code ?? null))
      const code = extractHtml(rawCode)

      setVersions((p) => [...p, { id: uid(), prompt: text, plan: r.plan, code, createdAt: Date.now() }])
      setCurrentIdx((i) => i + 1)
      setReloadKey((k) => k + 1)
      setStep(botId, 'code', 'done')
      patchMsg(botId, {
        content: `${r.plan}\n\n已生成 ${code.length} 字符（耗时 ${Math.round((Date.now() - t0) / 1000)}s），右侧可预览。`,
      })
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
        <ChatPanel messages={messages} busy={busy} elapsed={elapsed} onSend={handleSend} />
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
