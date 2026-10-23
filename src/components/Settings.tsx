import { useState } from 'react'
import type { LLMConfig } from '../config'
import { DEFAULT_CONFIG } from '../config'
import { chat } from '../llm'

interface Props {
  value: LLMConfig
  onSave: (c: LLMConfig) => void
  onClose: () => void
}

export default function Settings({ value, onSave, onClose }: Props) {
  const [c, setC] = useState<LLMConfig>(value)
  const [test, setTest] = useState('')

  async function testConn() {
    setTest('测试中…')
    try {
      const t0 = Date.now()
      const r = await chat(c, [{ role: 'user', content: '只回复两个字：连通' }], 0.3)
      setTest(`✅ 连通（${((Date.now() - t0) / 1000).toFixed(1)}s）：${r.slice(0, 20)}`)
    } catch (e: any) {
      setTest(`❌ ${e.message}`)
    }
  }

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>模型设置</h3>
        <p className="hint">Key 只存在你的浏览器 localStorage，不会上传任何服务器。</p>

        <label>
          API Key
          <input
            type="password"
            value={c.apiKey}
            placeholder="智谱开放平台的 API Key"
            onChange={(e) => setC({ ...c, apiKey: e.target.value })}
          />
        </label>
        <label>
          Base URL
          <input value={c.baseURL} onChange={(e) => setC({ ...c, baseURL: e.target.value })} />
        </label>
        <label>
          模型
          <input value={c.model} onChange={(e) => setC({ ...c, model: e.target.value })} />
        </label>
        <label>
          思维链
          <select
            value={c.thinking}
            onChange={(e) => setC({ ...c, thinking: e.target.value as any })}
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
          <button className="icon-btn" onClick={() => setC(DEFAULT_CONFIG)}>
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
