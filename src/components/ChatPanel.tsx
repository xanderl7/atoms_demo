import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'

interface Props {
  messages: Message[]
  busy: boolean
  /** 已等待秒数，生成时实时显示，避免看起来像卡死 */
  elapsed: number
  onSend: (text: string) => void
  onStop: () => void
}

export default function ChatPanel({ messages, busy, elapsed, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const submit = () => {
    const v = text.trim()
    if (!v || busy) return
    onSend(v)
    setText('')
  }

  const pick = (opt: string) => {
    if (busy) return
    onSend(opt)
    setText('')
  }

  return (
    <div className="chat">
      <div className="msgs">
        {messages.map((m) => (
          <div key={m.id}>
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
            {m.options && m.options.length > 0 && !busy && (
              <div className="options">
                {m.options.map((o) => (
                  <button key={o} className="opt" onClick={() => pick(o)}>
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="step running">
            <span className="dot" />
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
