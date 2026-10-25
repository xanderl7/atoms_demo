/**
 * 前端认证客户端：把登录态存在 localStorage（最简版，无 httpOnly Cookie /
 * JWT）。注册 / 登录都走 /api/auth/*，本地 dev 与线上 Vercel 同一套后端。
 */

const KEY = 'atoms-demo.auth'

export interface AuthUser {
  username: string
}

/** 读当前登录用户；没登录 / 解析失败返回 null */
export function loadAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as Partial<AuthUser>
    return u && typeof u.username === 'string' ? { username: u.username } : null
  } catch {
    return null
  }
}

export function saveAuth(u: AuthUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify(u))
  } catch {
    /* 隐私模式等写不进：退化为本次会话内有效 */
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}

interface AuthResult {
  ok: boolean
  error?: string
  user?: AuthUser
}

async function post(path: string, username: string, password: string): Promise<AuthResult> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = (await r.json().catch(() => ({}))) as { error?: string; user?: AuthUser }
    if (!r.ok) return { ok: false, error: data.error || `请求失败（${r.status}）` }
    return { ok: true, user: data.user }
  } catch (e: unknown) {
    const err = (e ?? {}) as { message?: string }
    return { ok: false, error: err.message || '网络错误' }
  }
}

export const register = (username: string, password: string) =>
  post('/api/auth/register', username, password)

export const login = (username: string, password: string) =>
  post('/api/auth/login', username, password)
