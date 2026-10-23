import type { LLMConfig } from './config'

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

/** 非流式：一次性拿完整回复 */
export async function chat(cfg: LLMConfig, messages: ChatMsg[], temperature = 0.7): Promise<string> {
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature, stream: false }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  return json.choices?.[0]?.message?.content ?? ''
}

/**
 * 流式：每来一段就回调 onDelta，最后返回完整文本。
 * 浏览器 fetch 直接读 SSE，不需要后端。
 */
export async function chatStream(
  cfg: LLMConfig,
  messages: ChatMsg[],
  onDelta?: (chunk: string, full: string) => void,
  temperature = 0.7
): Promise<string> {
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature, stream: true }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)

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
