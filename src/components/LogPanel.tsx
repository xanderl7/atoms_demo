import { useEffect, useState } from 'react'
import { log, type LogEntry } from '../logger'

interface Props {
  onClose: () => void
}

const time = (t: number) =>
  new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) +
  '.' +
  String(t % 1000).padStart(3, '0')

export default function LogPanel({ onClose }: Props) {
  const [items, setItems] = useState<LogEntry[]>(log.list())

  useEffect(() => log.subscribe(setItems), [])

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>运行日志</h3>
        <p className="hint">
          每一步请求、耗时、原始返回都在这里。生成失败时先看这个，别靠猜。
        </p>

        <div className="log-list">
          {items.length === 0 && <div className="log-empty">暂无日志</div>}
          {items.map((e, i) => (
            <div key={i} className={`log-row ${e.level}`}>
              <span className="log-time">{time(e.at)}</span>
              <span className="log-stage">{e.stage}</span>
              <span className="log-msg">
                {e.msg}
                {e.data !== undefined && (
                  <pre className="log-data">
                    {typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)}
                  </pre>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="icon-btn" onClick={() => log.download()}>
            导出 JSON
          </button>
          <button className="icon-btn" onClick={() => log.clear()}>
            清空
          </button>
          <div className="spacer" />
          <button className="send" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
