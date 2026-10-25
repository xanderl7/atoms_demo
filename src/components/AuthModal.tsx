import { useState } from 'react'
import { register, login } from '../auth'

interface Props {
  onClose: () => void
  onAuthed: (username: string) => void
}

/** 最简注册 / 登录弹窗：用户名 + 密码，无校验、无第三方。 */
export default function AuthModal({ onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setErr('')
    setBusy(true)
    const r = mode === 'login' ? await login(username, password) : await register(username, password)
    setBusy(false)
    if (!r.ok) {
      setErr(r.error || '操作失败')
      return
    }
    if (r.user) onAuthed(r.user.username)
    onClose()
  }

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'login' ? '登录' : '注册'}</h3>

        <div className="seg">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr('') }}>
            登录
          </button>
          <button
            className={mode === 'register' ? 'on' : ''}
            onClick={() => { setMode('register'); setErr('') }}
          >
            注册
          </button>
        </div>

        <label>
          用户名
          <input
            value={username}
            autoFocus
            placeholder="任意字符串"
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            placeholder="任意字符串"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        {err && (
          <p className="test-result" style={{ color: '#c0392b' }}>
            {err}
          </p>
        )}

        <div className="modal-actions">
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            取消
          </button>
          <button className="send" disabled={busy} onClick={submit}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </div>
      </div>
    </div>
  )
}
