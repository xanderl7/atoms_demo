/**
 * /zhipu/chat/completions 代理（Vercel Edge Function）。
 * vercel.json 把 /zhipu/* 重写到 /api/zhipu/*，本文件精确命中
 * /api/zhipu/chat/completions（应用唯一的端点，见 src/llm.ts 的 urlOf）。
 *
 * 与 dev 下 vite.config.ts 的 zhipuProxyPlugin 同一语义：
 *   1. 认证头优先级：X-Zhipu-Auth（应用发的自定义头，穿透会剥/改写
 *      Authorization 的边缘代理）→ 环境变量里的内置 Key → 请求自带的
 *      Authorization（baseURL 直连智谱的老路径）；
 *   2. 响应流式透传（SSE 代码生成走这条，不能缓冲）；
 *   3. 目标可用 ZHIPU_PROXY_TARGET 覆盖，换任何 OpenAI 兼容服务都不用改代码。
 *
 * 注：原先用的是 api/zhipu/[...path].ts 通配函数，但 Vercel 为 catch-all
 * 生成的路由正则只匹配单段路径（^/api/zhipu/([^/]+)$），而本端点是两段
 * /chat/completions，结果被兜底规则 ^/api(/.*)?$ 判成 404。改成精确文件
 * 路由后不再有歧义。
 */
export const config = { runtime: 'edge' }

const UPSTREAM = process.env.ZHIPU_PROXY_TARGET || 'https://open.bigmodel.cn'

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  // 兼容两种来源：rewrite 过来的 /api/zhipu/chat/completions 与直接请求的
  // /zhipu/chat/completions。本端点固定代理到上游的 chat/completions。
  const rest = url.pathname.replace(/^\/api\/zhipu\/?/, '').replace(/^\/zhipu\/?/, '') || 'chat/completions'
  const upstreamUrl = `${UPSTREAM}/api/paas/v4/${rest}${url.search}`

  const passthrough = req.headers.get('x-zhipu-auth')
  const builtin = process.env.ZHIPU_API_KEY
  const authorization =
    passthrough || (builtin ? `Bearer ${builtin}` : '') || req.headers.get('authorization') || ''

  const headers: Record<string, string> = {
    'content-type': req.headers.get('content-type') || 'application/json',
  }
  if (authorization) headers.authorization = authorization

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
  })

  // 透传状态码和内容类型；body 直接流式转发（不缓冲），SSE 才能实时到
  const outHeaders = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) outHeaders.set('content-type', contentType)
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders })
}
