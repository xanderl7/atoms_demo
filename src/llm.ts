import type { LLMConfig } from './config'
import { log } from './logger'

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

const urlOf = (cfg: LLMConfig) => `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`

const headersOf = (cfg: LLMConfig) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${cfg.apiKey}`,
})

/**
 * 统一发请求。若模型不支持关闭思考（glm-5.x 会报 1210），
 * 自动去掉 thinking 参数重试一次 —— 换模型不用改代码。
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 服务端 5xx / 429 自动重试。
 * 根因：生成一次要 45-90 秒，长连接很容易被网关掐断返回 500。
 * 5xx 重试经常就成功，4xx（参数错）不重试。
 */
const RETRY_TIMES = 2
const RETRY_DELAYS = [1500, 3000]

async function call(
  cfg: LLMConfig,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  label = 'llm'
): Promise<Response> {
  const send = async (p: Record<string, unknown>) => {
    try {
      return await fetch(urlOf(cfg), {
        method: 'POST',
        headers: headersOf(cfg),
        body: JSON.stringify(p),
        signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e // 用户主动中断，原样往上抛
      // fetch 本身抛错 = 请求根本没发出去：跨域被拦 / 代理没起 / 断网
      throw new Error(
        '请求发不出去。检查：① baseURL 是否为 /zhipu ② npm run dev 是否在运行 ③ 网络'
      )
    }
  }

  for (let i = 0; i <= RETRY_TIMES; i++) {
    const res = await send(payload)
    if (res.ok) return res

    const text = await res.text()

    // 模型不支持关思考（glm-5.x 报 1210）：去掉参数重试
    if (payload.thinking && /1210|不支持关闭思考/.test(text)) {
      const { thinking, ...rest } = payload
      return send(rest)
    }

    const retryable = res.status >= 500 || res.status === 429
    if (retryable && i < RETRY_TIMES) {
      log.warn(label, `服务端 ${res.status}，${RETRY_DELAYS[i] / 1000}s 后重试（第 ${i + 1} 次）`, text.slice(0, 150))
      await sleep(RETRY_DELAYS[i])
      continue
    }
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`)
  }
  throw new Error('LLM 请求失败（重试耗尽）')
}

const basePayload = (cfg: LLMConfig, messages: ChatMsg[], temperature: number, stream: boolean) => ({
  model: cfg.model,
  messages,
  temperature,
  stream,
  thinking: { type: cfg.thinking },
})

/** 非流式：一次性拿完整回复。signal 用于中断 */
export async function chat(
  cfg: LLMConfig,
  messages: ChatMsg[],
  temperature = 0.7,
  signal?: AbortSignal
): Promise<string> {
  const res = await call(cfg, basePayload(cfg, messages, temperature, false), signal, 'chat')
  const json = await res.json()
  return json.choices?.[0]?.message?.content ?? ''
}

/**
 * 流式：每来一段就回调 onDelta，最后返回完整文本。
 * 只取 delta.content，模型的思维链（reasoning_content）会被自动丢弃，不会污染代码。
 */
export async function chatStream(
  cfg: LLMConfig,
  messages: ChatMsg[],
  onDelta?: (chunk: string, full: string) => void,
  temperature = 0.7,
  signal?: AbortSignal
): Promise<string> {
  const res = await call(cfg, basePayload(cfg, messages, temperature, true), signal, 'codegen')

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split('\n')
    buf = lines.pop() ?? '' // 最后一行可能不完整，留到下轮

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta?.(delta, full)
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
  return full
}
