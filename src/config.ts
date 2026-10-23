/** LLM 配置：存 localStorage，纯前端直连。将来加后端代理只改 baseURL */

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

const KEY = 'atoms-demo.llm-config'

export const DEFAULT_CONFIG: LLMConfig = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.6',
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
