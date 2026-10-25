/** LLM 配置：存 localStorage，纯前端直连。将来加后端代理只改 baseURL */

import type { Message, AppVersion } from './types'

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
  /**
   * Key 来源：
   *   builtin —— 仓库自带的内置体验 Key（dev server 从 .env 下发，优先使用）
   *   custom  —— 用户自己填的
   * 用来在设置面板和顶栏提示「你用的是谁的 Key」。
   */
  keySource: 'builtin' | 'custom'
  /**
   * 内置体验 Key 的【首次使用时间戳】—— 只用于文案提示
   * （"有效期 7 天，至 X 日期"），【不做任何硬拦截】：
   * 到期不清 Key、不拦请求。真正的回收手段是服务端把 .env 里的
   * Key 换掉/删掉（builtin-key 端点就会下发空值）。
   */
  builtinStartedAt: number | null
}

const KEY = 'atoms-demo.llm-config'

/** 内置体验 Key 的承诺有效期（天）—— 只用于文案提示 */
export const BUILTIN_KEY_DAYS = 7

export const DEFAULT_CONFIG: LLMConfig = {
  // 走 Vite 本地代理 /zhipu（见 vite.config.ts），绕开浏览器跨域。
  // 想直连就填 https://open.bigmodel.cn/api/paas/v4
  baseURL: '/zhipu',
  apiKey: '',
  model: 'glm-4.5-air',
  thinking: 'disabled',
  keySource: 'custom',
  builtinStartedAt: null,
}

/**
 * 「这台浏览器第一次用内置 Key 的时间」的持久化 key。
 *
 * 为什么单独存而不只存在 config 里：用户中途换成自己的 Key 再切回来时，
 * config 里的 builtinStartedAt 会丢。起算点是承诺有效期的锚，必须独立
 * 存活，否则切一次 Key 就等于把 7 天续期了。
 */
const STARTED_KEY = 'atoms-demo.builtin-started'

/** 读「这台浏览器」内置 Key 的首次使用时间；从没用过返回 null */
export function readBuiltinStarted(): number | null {
  try {
    const raw = localStorage.getItem(STARTED_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** 取内置 Key 的起算时间：没有就按 now 记下并持久化（只记一次） */
export function stampBuiltinStarted(now: number = Date.now()): number {
  const existing = readBuiltinStarted()
  if (existing) return existing
  try {
    localStorage.setItem(STARTED_KEY, String(now))
  } catch {
    /* 隐私模式等写不进的场景：退化为本次会话内有效 */
  }
  return now
}

/**
 * 内置 Key 生效时的模型选择，一处定义两处复用（首次自动套用 / 设置里恢复）：
 * 用户在设置里自己改过的（跟代码默认值不一样的）保留，不被内置 Key 冲掉；
 * 没改过（还是 DEFAULT_CONFIG.model）就以下发的默认值为准 —— 否则 .env 里的
 * ZHIPU_MODEL 永远不生效，那个配置项就是骗人的。
 */
export function pickBuiltinModel(c: LLMConfig, endpointModel: string): string {
  return c.model && c.model !== DEFAULT_CONFIG.model ? c.model : endpointModel || c.model
}

/**
 * 把内置体验 Key 套进配置。
 * 模型选择见 pickBuiltinModel。
 */
export function applyBuiltinKey(
  c: LLMConfig,
  key: string,
  model: string,
  now: number = Date.now()
): LLMConfig {
  return {
    ...c,
    apiKey: key,
    model: pickBuiltinModel(c, model),
    keySource: 'builtin',
    builtinStartedAt: stampBuiltinStarted(now),
  }
}

/** 内置 Key 的展示状态：给 UI 做文案提示用（不拦截任何请求） */
export interface BuiltinKeyState {
  /** 正在用内置 Key */
  active: boolean
  /** 首次使用时间（没用过为 null） */
  startedAt: number | null
  /** 承诺有效期至（startedAt + 7 天；没用过为 null）—— 纯展示 */
  expiresAt: number | null
}

export function builtinKeyState(c: LLMConfig): BuiltinKeyState {
  if (c.keySource !== 'builtin' || !c.apiKey) {
    return { active: false, startedAt: null, expiresAt: null }
  }
  const startedAt = c.builtinStartedAt ?? readBuiltinStarted()
  return {
    active: true,
    startedAt,
    expiresAt: startedAt ? startedAt + BUILTIN_KEY_DAYS * 24 * 60 * 60 * 1000 : null,
  }
}

export function loadConfig(): LLMConfig {
  try {
    const c: LLMConfig = rawConfig()
      ? { ...DEFAULT_CONFIG, ...JSON.parse(rawConfig()!) }
      : { ...DEFAULT_CONFIG }

    // 历史遗留修复：早期默认填的是直连地址，浏览器会被跨域拦（Failed to fetch）。
    // 只要是智谱域名就悄悄改回走本地代理。
    if (/^https?:\/\//.test(c.baseURL) && c.baseURL.includes('bigmodel.cn')) {
      c.baseURL = DEFAULT_CONFIG.baseURL
      saveConfig(c)
    }
    return c
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function rawConfig(): string | null {
  return localStorage.getItem(KEY)
}

export function saveConfig(c: LLMConfig) {
  localStorage.setItem(KEY, JSON.stringify(c))
}

/* ============================================================
 * 会话持久化：刷新页面保留对话 / 已生成代码 / 预览效果。
 * 与 LLMConfig 分开存（KEY 只管 Key，这里管会话内容）。
 * 只存「产物」不存「过程」：messages / versions / currentIdx / view；
 * busy / elapsed 是瞬时态不存，clarifyRounds 等澄清上下文重置会话时一起清。
 * ============================================================ */
const SESSION_KEY = 'atoms-demo.session'

export interface SessionState {
  messages: Message[]
  versions: AppVersion[]
  currentIdx: number
  view: 'preview' | 'code'
}

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<SessionState>
    if (!s || !Array.isArray(s.messages)) return null
    return {
      messages: s.messages as Message[],
      versions: Array.isArray(s.versions) ? (s.versions as AppVersion[]) : [],
      currentIdx: typeof s.currentIdx === 'number' ? s.currentIdx : -1,
      view: s.view === 'code' ? 'code' : 'preview',
    }
  } catch {
    return null
  }
}

export function saveSession(s: SessionState) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* 隐私模式等写不进：退化为本次会话内有效 */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* 同上 */
  }
}
