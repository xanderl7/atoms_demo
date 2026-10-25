/**
 * 注册端点（Vercel Edge Function）。
 */
export const config = { runtime: 'edge' }

import { registerUser } from '../_lib/authDb.js'

interface Body {
  username?: unknown
  password?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (username.length > 32) return Response.json({ error: '用户名过长（≤32 字符）' }, { status: 400 })
  if (password.length > 128) return Response.json({ error: '密码过长（≤128 字符）' }, { status: 400 })

  const r = await registerUser(username, password)
  if (!r.ok) {
    return Response.json({ error: r.error }, { status: r.code === 'DUP' ? 409 : 400 })
  }
  return Response.json({ ok: true, user: { username } }, { status: 201 })
}
