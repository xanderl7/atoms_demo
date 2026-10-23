import { useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import PreviewPane from './components/PreviewPane'
import CodePane from './components/CodePane'
import Settings from './components/Settings'
import LogPanel from './components/LogPanel'
import type { AppVersion, Message, Step } from './types'
import { loadConfig, saveConfig, type LLMConfig } from './config'
import { chat } from './llm'
import { SYSTEM_ROUTER, parseRouter, buildCodeMessages, extractHtml } from './prompts'
import { log } from './logger'

const uid = () => Math.random().toString(36).slice(2, 9)

const STEP_LABELS = [
  { id: 'route', label: '判断意图' },
  { id: 'plan', label: '拆解需求' },
  { id: 'code', label: '生成代码' },
]

const mkSteps = (): Step[] => STEP_LABELS.map((s) => ({ ...s, status: 'pending' }))
const doneSteps = (ids: string[]): Step[] =>
  STEP_LABELS.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, status: 'done' }))

const isAbort = (e: any) => e?.name === 'AbortError'

export default function App() {
  const [cfg, setCfg] = useState<LLMConfig>(loadConfig)
  const [showSettings, setShowSettings] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), role: 'assistant', content: '你好，描述一个你想要的应用，我来帮你把它做出来。' },
  ])
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  /** 上一轮问了澄清问题，用户这次的回答要跟原需求合并后再生成 */
  const pendingRef = useRef<string | null>(null)

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

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleSend(text: string) {
    const t0 = Date.now()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    // 上一轮澄清过：把回答跟原需求拼起来，这次直接开工，不再重复问
    const original = pendingRef.current
    pendingRef.current = null
    const enriched = original
      ? `需求：${original}\n\n补充确认：${text}`
      : text

    log.info('send', original ? '收到澄清回答，合并原需求' : '收到用户输入', { text, original })

    setBusy(true)
    setMessages((p) => [...p, { id: uid(), role: 'user', content: text }])

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
    setMessages((p) => [...p, { id: botId, role: 'assistant', content: '', steps: mkSteps() }])

    try {
      // ---- Step 1: 判意图 ----
      setStep(botId, 'route', 'running')
      const t1 = Date.now()
      const raw = await chat(
        cfg,
        [
          { role: 'system', content: SYSTEM_ROUTER },
          { role: 'user', content: enriched },
        ],
        0.2,
        signal
      )
      log.info('route', `意图判断完成 ${Date.now() - t1}ms`, { raw: raw.slice(0, 400) })
      const r = parseRouter(raw)
      log.info('route', `判定结果 intent=${r.intent}`)
      setStep(botId, 'route', 'done')

      // 聊天：只回文字
      if (r.intent === 'chat') {
        patchMsg(botId, {
          content: r.reply || '你好！描述一个你想要的应用，我来帮你做出来。',
          steps: doneSteps(['route']),
        })
        setBusy(false)
        return
      }

      // 需求模糊：先问清楚，把选项摆给用户点，不急着生成
      if (r.intent === 'clarify' && !original) {
        pendingRef.current = text
        patchMsg(botId, {
          content: r.reply || '我还不太确定你想要什么，先确认一下：',
          steps: doneSteps(['route']),
          options: [...(r.options ?? []), '就按你默认的来'],
        })
        setBusy(false)
        return
      }

      // ---- Step 2: 拆需求 ----
      setStep(botId, 'plan', 'running')
      const plan = r.plan || (r.reply ? `- ${r.reply}` : '')
      setStep(botId, 'plan', 'done')
      patchMsg(botId, { content: plan })

      // ---- Step 3: 生成代码 ----
      setStep(botId, 'code', 'running')
      const t2 = Date.now()
      const rawCode = await chat(
        cfg,
        buildCodeMessages(enriched, plan, current?.code ?? null),
        0.7,
        signal
      )
      const code = extractHtml(rawCode)
      log.info('codegen', `生成完成 ${Date.now() - t2}ms，${rawCode.length} 字符`, {
        fenced: /```html/.test(rawCode),
        codeLen: code.length,
        head: code.slice(0, 120),
        tail: code.slice(-80),
      })

      if (!code || code.length < 50) {
        throw new Error(`模型没返回可用代码（长度 ${code.length}），原始返回：${rawCode.slice(0, 200)}`)
      }

      setVersions((p) => [...p, { id: uid(), prompt: enriched, plan, code, createdAt: Date.now() }])
      setCurrentIdx((i) => i + 1)
      setReloadKey((k) => k + 1)
      setStep(botId, 'code', 'done')
      patchMsg(botId, {
        content: `${plan}\n\n已生成 ${code.length} 字符（耗时 ${Math.round((Date.now() - t0) / 1000)}s），右侧可预览。`,
      })
    } catch (e: any) {
      if (isAbort(e)) {
        log.warn('abort', '用户中断了生成')
        patchMsg(botId, {
          content: '已中断。',
          steps: mkSteps().map((s) => ({ ...s, status: 'error' as const })),
        })
      } else {
        log.error('error', `生成失败：${e.message}`, { stack: e.stack?.slice(0, 300) })
        setMessages((p) =>
          p.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  content: `生成失败：${e.message}\n\n右上角「日志」里有完整过程。`,
                  steps: m.steps?.map((s) => ({ ...s, status: 'error' as const })),
                }
              : m
          )
        )
      }
    } finally {
      abortRef.current = null
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
        <button className="icon-btn" onClick={() => setShowLog(true)}>
          日志
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="模型设置">
          ⚙︎
        </button>
      </div>

      <div className="main">
        <ChatPanel
          messages={messages}
          busy={busy}
          elapsed={elapsed}
          onSend={handleSend}
          onStop={stop}
        />
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
      {showLog && <LogPanel onClose={() => setShowLog(false)} />}
    </div>
  )
}
