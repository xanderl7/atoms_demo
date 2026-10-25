import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'

interface Props {
  messages: Message[]
  busy: boolean
  /** 已等待秒数，生成时实时显示，避免看起来像卡死 */
  elapsed: number
  /** fromOption：这一轮是不是点的选项。点了就是已作答，App 必须出东西不许再追问 */
  onSend: (text: string, fromOption?: boolean) => void
  onStop: () => void
}

export default function ChatPanel({ messages, busy, elapsed, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 用户是不是正贴着底部看。只有贴着底部才自动滚，否则用户往上翻会被拽回来 */
  const [atBottom, setAtBottom] = useState(true)

  // 只有最后一条助手消息的选项能点 —— 否则旧选项会一直挂着，用户点错轮次
  const lastAssistantIdx = messages.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1)

  // 滚动位置变化时记录"是否在底部"。
  // 生成过程中流式进度每 400ms 更新一次消息，messages 引用一直变 ——
  // 如果不判断这个，用户往上翻看历史会被无休止地拽回底部。
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }

  useEffect(() => {
    // 用户上滚去看历史了，就别自动滚
    if (!atBottom) return
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, atBottom])

  const submit = () => {
    const v = text.trim()
    if (!v || busy) return
    onSend(v, false)
    setText('')
  }

  const pick = (opt: string) => {
    if (busy) return
    onSend(opt, true)
    setText('')
  }

  return (
    <div className="chat">
      <div className="msgs" ref={scrollRef} onScroll={onScroll}>
        {messages.map((m, i) => (
          <div key={m.id} className={`row ${m.role}`}>
            <div className="avatar" aria-hidden="true">
              {m.role === 'assistant' ? 'AI' : '我'}
            </div>
            <div className="col">
              <div className={`bubble ${m.role}`}>{m.content}</div>

              {m.steps && (
                <div className="steps">
                  {m.steps.map((s) => (
                    <div key={s.id} className={`step ${s.status}`}>
                      <span className="dot" />
                      {s.label}
                    </div>
                  ))}
                </div>
              )}

              {/* Human-in-the-loop：选项直接可点，不用手打 */}
              {m.options && m.options.length > 0 && !busy && i === lastAssistantIdx && (
                <div className="options">
                  {m.options.map((o) => (
                    <button key={o} className="opt" onClick={() => pick(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="step running waiting">
            <svg className="hourglass" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12M6 21h12M6 3c0 4.5 4.5 6 6 9-1.5 3-6 4.5-6 9M18 3c0 4.5-4.5 6-6 9 1.5 3 6 4.5 6 9" />
            </svg>
            已等待 {elapsed}s{elapsed > 15 ? '（生成较慢，通常 20-40s）' : ''}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          rows={2}
          value={text}
          placeholder="描述你想要的应用，回车发送…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {busy ? (
          <button className="send stop" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="send" disabled={!text.trim()} onClick={submit}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
