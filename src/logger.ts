/**
 * 运行日志。生成失败时必须有据可查 —— 否则只能靠猜。
 * 同时写三处：console（开发看）、内存（UI 看）、localStorage（刷新后还在）。
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  at: number
  level: LogLevel
  stage: string
  msg: string
  data?: unknown
}

const KEY = 'atoms-demo.logs'
const MAX = 300

let entries: LogEntry[] = load()
const listeners = new Set<(e: LogEntry[]) => void>()

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)))
  } catch {
    /* 配额满了就算了 */
  }
}

function push(level: LogLevel, stage: string, msg: string, data?: unknown) {
  const e: LogEntry = { at: Date.now(), level, stage, msg, data }
  entries = [...entries, e].slice(-MAX)
  persist()
  listeners.forEach((fn) => fn(entries))

  const tag = `%c[${stage}]`
  const color = level === 'error' ? 'color:#f87171' : level === 'warn' ? 'color:#fbbf24' : 'color:#60a5fa'
  if (level === 'error') console.error(tag, color, msg, data ?? '')
  else console.log(tag, color, msg, data ?? '')
}

export const log = {
  info: (stage: string, msg: string, data?: unknown) => push('info', stage, msg, data),
  warn: (stage: string, msg: string, data?: unknown) => push('warn', stage, msg, data),
  error: (stage: string, msg: string, data?: unknown) => push('error', stage, msg, data),
  list: () => entries,
  clear: () => {
    entries = []
    persist()
    listeners.forEach((fn) => fn(entries))
  },
  subscribe: (fn: (e: LogEntry[]) => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** 导出成 JSON 文件下载 —— 真正的「落盘」 */
  download: () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `atoms-demo-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  },
}
