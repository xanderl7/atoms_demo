import { useState } from 'react'
import type { LLMConfig } from '../config'
import { DEFAULT_CONFIG } from '../config'

interface Props {
  value: LLMConfig
  onSave: (c: LLMConfig) => void
  onClose: () => void
}

export default function Settings({ value, onSave, onClose }: Props) {
  const [c, setC] = useState<LLMConfig>(value)

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

        <div className="modal-actions">
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
