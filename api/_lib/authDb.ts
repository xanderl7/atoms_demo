/**
 * 用户存储（Vercel KV + 内存 fallback）。
 *
 * 线上（Vercel Edge）：用 Vercel KV（Upstash Redis）持久化，跨实例共享。
 * 本地（dev/preview）：KV 未配置时回退到内存 Map，功能正常但数据不持久。
 *
 * 密码用 PBKDF2（Web Crypto API）加盐哈希存储，不存明文。
 */

// @vercel/kv 在 Edge / Node.js 均可使用；未配置时 kv.get/set 会抛错，
// 这里通过 env 检测决定走哪条存储。
let kv: import('@vercel/kv').VercelKV | null = null

function kvReady(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

async function getKv() {
  if (kv) return kv
  if (!kvReady()) return null
  const { kv: client } = await import('@vercel/kv')
  kv = client
  return kv
}

const mem = new Map<string, { pw_hash: string }>()

async function getUser(username: string): Promise<{ pw_hash: string } | null> {
  const client = await getKv()
  if (client) {
    const data = await client.get<string>(`auth:user:${username}`)
    return data ? { pw_hash: data } : null
  }
  return mem.get(username) ?? null
}

async function setUser(username: string, pw_hash: string): Promise<void> {
  const client = await getKv()
  if (client) {
    await client.set(`auth:user:${username}`, pw_hash)
    return
  }
  mem.set(username, { pw_hash })
}

async function hasUser(username: string): Promise<boolean> {
  const client = await getKv()
  if (client) {
    const data = await client.get<string>(`auth:user:${username}`)
    return data !== null
  }
  return mem.has(username)
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

function toHex(buf: Uint8Array | ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pw), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return `${toHex(salt)}:${toHex(derived)}`
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pw), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return toHex(derived) === keyHex
}

export interface RegisterResult {
  ok: boolean
  error?: string
  code?: 'DUP' | 'BAD'
}

export async function registerUser(username: string, password: string): Promise<RegisterResult> {
  if (!username || !password) {
    return { ok: false, error: '用户名和密码不能为空', code: 'BAD' }
  }
  if (await hasUser(username)) return { ok: false, error: '用户名已存在', code: 'DUP' }
  await setUser(username, await hashPassword(password))
  return { ok: true }
}

export async function verifyUser(username: string, password: string): Promise<boolean> {
  if (!username || !password) return false
  const user = await getUser(username)
  if (!user) return false
  return verifyPassword(password, user.pw_hash)
}
