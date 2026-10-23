/** LLM 配置：存 localStorage，纯前端直连。将来加后端代理只改 baseURL */

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
  /**
   * 是否关闭思维链。glm-4.5-air / glm-4.6 支持关闭；
   * glm-5.x 强制思考，关不掉 —— llm.ts 里会自动去掉这个参数重试。
   * 实测关掉后生成同样页面快 3-4 倍。
   */
  thinking: 'disabled' | 'enabled'
}

const KEY = 'atoms-demo.llm-config'

export const DEFAULT_CONFIG: LLMConfig = {
  // 走 Vite 本地代理 /zhipu（见 vite.config.ts），绕开浏览器跨域。
  // 想直连就填 https://open.bigmodel.cn/api/paas/v4
  baseURL: '/zhipu',
  apiKey: '',
  model: 'glm-4.5-air',
  thinking: 'disabled',
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
