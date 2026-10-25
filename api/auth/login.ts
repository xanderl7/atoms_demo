/**
 * 登录端点（Vercel Edge Function）。
 */
export const config = { runtime: 'edge' }

import { verifyUser } from '../_lib/authDb.js'

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

  const ok = await verifyUser(username, password)
  if (!ok) return Response.json({ error: '用户名或密码错误' }, { status: 401 })
  return Response.json({ ok: true, user: { username } })
}
