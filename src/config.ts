/** LLM 配置：存 localStorage，纯前端直连。将来加后端代理只改 baseURL */

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

const KEY = 'atoms-demo.llm-config'

export const DEFAULT_CONFIG: LLMConfig = {
  // 走 Vite 本地代理 /zhipu（见 vite.config.ts），绕开浏览器跨域。
  // 想直连就填 https://open.bigmodel.cn/api/paas/v4
  baseURL: '/zhipu',
  apiKey: '',
  model: 'glm-4.5-air',
}

export function loadConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(c: LLMConfig) {
  localStorage.setItem(KEY, JSON.stringify(c))
}
