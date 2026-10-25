import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * 内置体验 Key 下发端点（/api/builtin-key）。
 *
 * 作业提交要「开箱即用」：面试官 clone 下来 npm run dev，页面上直接就能
 * 生成，不用先去注册智谱账号。Key 放在 .env 的 ZHIPU_API_KEY 里，
 * 【故意不加 VITE_ 前缀】—— 这样它不会被打进前端 bundle，只经这个
 * 服务端端点下发。
 *
 * 注意：dev/preview 都能用，静态部署（dist 直接 serve）没有这个端点，
 * 前端 fetch 会静默失败，回退到「填自己的 Key」流程，不影响使用。
 *
 * 7 天有效期只做前端文案提示，不做硬拦截 —— 真正的回收手段是服务端
 * 把 .env 里的 Key 删掉/换掉（端点下发空值，前端自动回退）。
 */
function builtinKeyPlugin(env: Record<string, string>): Plugin {
  const middleware = (
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; end: (s: string) => void },
    next: () => void
  ) => {
    if (!req.url?.startsWith('/api/builtin-key')) return next()
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        apiKey: env.ZHIPU_API_KEY || '',
        model: env.ZHIPU_MODEL || 'glm-4.5-air',
      })
    )
  }
  return {
    name: 'builtin-key',
    configureServer(s) {
      s.middlewares.use(middleware)
    },
    configurePreviewServer(s) {
      s.middlewares.use(middleware)
    },
  }
}

/**
 * /zhipu 转发中间件：把 /zhipu/* 转发到智谱（默认）或任何
 * OpenAI 兼容服务（ZHIPU_PROXY_TARGET 覆盖）。
 *
 * 为什么不用 Vite 自带的 proxy 配置：实测两个坑——
 *   ① Vite 6 打包的 http-proxy 不透传 onProxyReq，没法在转发前改头；
 *   ② 线上部署时平台边缘代理会把请求的 Authorization 剥掉/改写，
 *      智谱收到无效令牌报 401（本地同样的代理配置却是好的，问题在边缘）。
 * 所以自己用 node https 转发，头完全可控：
 *   - 应用同时发 X-Zhipu-Auth 自定义头（见 src/llm.ts）穿透边缘，
 *     这里优先用它补回 Authorization；
 *   - 没有任何认证头时（比如边缘把自定义头也剥了），直接注入 .env
 *     里的内置 Key —— 内置 Key 用户在任何部署形态下都能用；
 *   - 只有 Authorization 时原样用（baseURL 直连智谱的老路径）。
 * 响应流式透传（SSE），不缓冲。
 */
function zhipuProxyPlugin(env: Record<string, string>): Plugin {
  const target = env.ZHIPU_PROXY_TARGET || 'https://open.bigmodel.cn'
  const builtinKey = env.ZHIPU_API_KEY || ''
  const isHttps = target.startsWith('https')

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/zhipu' && !req.url?.startsWith('/zhipu/')) return next()

    // /zhipu/chat/completions → /api/paas/v4/chat/completions（query 原样保留）
    const upstreamPath = req.url.replace(/^\/zhipu/, '/api/paas/v4')

      // 收集请求体（都是小 JSON；响应不收集，直接流式透传）
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const passthrough = req.headers['x-zhipu-auth'] as string | undefined
        // 认证头优先级：X-Zhipu-Auth（应用发的，穿透边缘）→ 内置 Key
        // （服务端 .env，部署方说了算）→ 请求自带的 Authorization。
        // 内置 Key 优先于自带 Authorization：链路上可能有代理会注入/改写
        // Authorization（实测某部署平台就这么干），自带的值不可信；
        // 没有内置 Key 时才用自带的（baseURL 直连智谱的老路径）。
        const authorization =
          passthrough || (builtinKey ? `Bearer ${builtinKey}` : '') ||
          (req.headers['authorization'] as string | undefined) ||
          ''

      const doRequest = isHttps ? httpsRequest : httpRequest
      const upstream = doRequest(
        new URL(target + upstreamPath),
        {
          method: req.method,
          headers: {
            'content-type': (req.headers['content-type'] as string) || 'application/json',
            authorization,
            'content-length': body.length,
          },
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res) // SSE 流式透传
        }
      )
      upstream.on('error', (e: Error) => {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `代理上游失败：${e.message}` } }))
      })
      if (body.length) upstream.write(body)
      upstream.end()
    })
  }

  return {
    name: 'zhipu-proxy',
    configureServer(s) {
      s.middlewares.use(middleware)
    },
    configurePreviewServer(s) {
      s.middlewares.use(middleware)
    },
  }
}

/**
 * /api/auth/* 端点（注册 / 登录）。
 *
 * 与线上 Vercel Node 函数 api/auth/*.ts 同一语义，只是这里跑在本地
 * vite dev / preview 的 Node 中间件里，复用 api/_lib/authDb（better-sqlite3
 * 落本地 data/users.db）。用户点「注册 / 登录」时前端 fetch 这两个路径，
 * 本地和线上行为一致。
 */
function authPlugin(): Plugin {
  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
        } catch {
          resolve({})
        }
      })
    })

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || ''
    if (url !== '/api/auth/register' && url !== '/api/auth/login') return next()
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method Not Allowed')
      return
    }
    const body = await readJson(req)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    // 延迟加载：只有真正打到 auth 端点才 import better-sqlite3。
    const { registerUser, verifyUser } = await import('./api/_lib/authDb')

    let out: Record<string, unknown>
    let status = 200
    if (url === '/api/auth/register') {
      if (username.length > 32) {
        out = { error: '用户名过长（≤32 字符）' }
        status = 400
      } else if (password.length > 128) {
        out = { error: '密码过长（≤128 字符）' }
        status = 400
      } else {
        const r = await registerUser(username, password)
        if (!r.ok) {
          out = { error: r.error }
          status = r.code === 'DUP' ? 409 : 400
        } else {
          out = { ok: true, user: { username } }
          status = 201
        }
      }
    } else {
      const ok = await verifyUser(username, password)
      if (!ok) {
        out = { error: '用户名或密码错误' }
        status = 401
      } else {
        out = { ok: true, user: { username } }
      }
    }

    res.setHeader('Content-Type', 'application/json')
    res.statusCode = status
    res.end(JSON.stringify(out))
  }

  return {
    name: 'auth',
    configureServer(s) {
      s.middlewares.use(handler)
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler)
    },
  }
}

export default defineConfig(({ mode }) => {
  // 第三个参数 '' = 不带前缀过滤，加载 .env 里全部变量（含 ZHIPU_API_KEY）。
  // 注意：.env 不会自动进 process.env，必须显式 loadEnv。
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), builtinKeyPlugin(env), zhipuProxyPlugin(env), authPlugin()],
    // allowedHosts: true = 不校验 Host 头。线上部署时 preview 经反向代理
    // 被外部域名访问，不放行会被 Vite 拦："Blocked request. This host
    // is not allowed."（部署沙箱的硬性要求）
    server: { port: 5173, host: true, allowedHosts: true },
    // host 0.0.0.0：部署沙箱要求服务监听 $PORT 且绑所有网卡
    preview: { port: 4173, host: '0.0.0.0', allowedHosts: true },
  }
})
