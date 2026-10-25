import { useState } from 'react'
import type { LLMConfig } from '../config'
import { DEFAULT_CONFIG, builtinKeyState, applyBuiltinKey } from '../config'
import { chat } from '../llm'

interface Props {
  value: LLMConfig
  onSave: (c: LLMConfig) => void
  onClose: () => void
}

/** 2026-03-14 12:00 这种格式，给文案提示用 */
const fmt = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Settings({ value, onSave, onClose }: Props) {
  const [c, setC] = useState<LLMConfig>(value)
  const [test, setTest] = useState('')

  const kb = builtinKeyState(c)
  const usingBuiltin = c.keySource === 'builtin'

  async function testConn() {
    setTest('测试中…')
    try {
      const t0 = Date.now()
      const r = await chat(c, [{ role: 'user', content: '只回复两个字：连通' }], 0.3)
      setTest(`✅ 连通（${((Date.now() - t0) / 1000).toFixed(1)}s）：${r.slice(0, 20)}`)
    } catch (e: unknown) {
      const err = (e ?? {}) as { message?: string }
      setTest(`❌ ${err.message ?? String(e)}`)
    }
  }

  /**
   * 重置：恢复默认态。
   * 不只是 setC(DEFAULT_CONFIG) —— 那样 API Key 会变空，还得手动去
   * /api/builtin-key 再要一次。这里直接向服务端把内置 Key 要回来填上，
   * 面板立刻就是「开箱即用」的样子。
   */
  async function resetToDefault() {
    setC({ ...DEFAULT_CONFIG })
    try {
      const r = await fetch('/api/builtin-key')
      const data: { apiKey?: string; model?: string } | null = r.ok ? await r.json() : null
      if (!data?.apiKey) {
        setTest('❌ 服务端没有内置 Key（没配 ZHIPU_API_KEY），已重置其余配置')
        return
      }
      setC((prev) => applyBuiltinKey(prev, data.apiKey!, data.model ?? ''))
      // 重置成功不再弹绿色成功提示（用户要求删除），只保留失败提示
      setTest('')
    } catch {
      setTest('❌ 拿不到内置 Key（静态部署没有该端点），已重置其余配置')
    }
  }

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>模型设置</h3>
        <p className="hint">Key 只存在你的浏览器 localStorage，不会上传任何服务器。</p>

        {/* ── Key 来源 + 有效期文案提示（只提示，不拦截）───────── */}
        {usingBuiltin && (
          <div className="key-notice">
            <b>正在使用内置体验 Key</b>
            <br />
            仅供体验，有效期 7 天
            {kb.expiresAt ? <>（至 {fmt(kb.expiresAt)}）</> : null}
          </div>
        )}

        <label>
          API Key
          <input
            type="password"
            value={c.apiKey}
            placeholder="默认已填好内置体验 Key；想用自己的就覆盖它，清空保存则回退内置"
            onChange={(e) => setC({ ...c, apiKey: e.target.value, keySource: 'custom' })}
          />
        </label>
        <label>
          Base URL
          <input value={c.baseURL} onChange={(e) => setC({ ...c, baseURL: e.target.value })} />
        </label>
        <label>
          模型
          <input
            value={c.model}
            placeholder="如 glm-4.5-air / glm-4.6 / glm-4-plus"
            onChange={(e) => setC({ ...c, model: e.target.value })}
          />
        </label>
        <label>
          思维链
          <select
            value={c.thinking}
            onChange={(e) => setC({ ...c, thinking: e.target.value as LLMConfig['thinking'] })}
          >
            <option value="disabled">关闭（快 3-4 倍，推荐）</option>
            <option value="enabled">开启（复杂需求可能更准）</option>
          </select>
        </label>

        {test && <p className="test-result">{test}</p>}

        <div className="modal-actions">
          <button className="icon-btn" onClick={testConn}>
            测试连接
          </button>
          <button className="icon-btn" onClick={resetToDefault}>
            重置
          </button>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="send"
            onClick={() => {
              onSave(c)
              onClose()
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
