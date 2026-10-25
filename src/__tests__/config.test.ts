import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_CONFIG,
  BUILTIN_KEY_DAYS,
  stampBuiltinStarted,
  readBuiltinStarted,
  applyBuiltinKey,
  builtinKeyState,
  loadConfig,
  type LLMConfig,
} from '../config'

/**
 * config.ts 在浏览器里用 localStorage。Node 单测环境没有，
 * 这里注入一个内存版 mock（语义对齐 Web Storage API）。
 */
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  store.clear()
})

describe('stampBuiltinStarted 首次使用时间', () => {
  it('第一次调用记下 now', () => {
    expect(stampBuiltinStarted(1000)).toBe(1000)
    expect(readBuiltinStarted()).toBe(1000)
  })

  it('只记一次：之后再调用返回旧值，不续期', () => {
    stampBuiltinStarted(1000)
    expect(stampBuiltinStarted(9999)).toBe(1000)
    expect(readBuiltinStarted()).toBe(1000)
  })

  it('独立持久化：不依赖 config，切走 Key 再切回不丢', () => {
    stampBuiltinStarted(1000)
    // 模拟用户换成自己的 Key（config 里 builtinStartedAt 丢了），
    // 但起算时间还活在独立 key 里
    expect(readBuiltinStarted()).toBe(1000)
  })
})

describe('applyBuiltinKey 套用内置 Key', () => {
  it('填 Key、标来源、记时间', () => {
    const c = applyBuiltinKey(DEFAULT_CONFIG, 'builtin-key', 'glm-4.5-air', 1000)
    expect(c.apiKey).toBe('builtin-key')
    expect(c.keySource).toBe('builtin')
    expect(c.builtinStartedAt).toBe(1000)
  })

  it('保留用户已选的模型，不被下发的默认值冲掉', () => {
    const mine: LLMConfig = { ...DEFAULT_CONFIG, model: 'glm-4.6' }
    const c = applyBuiltinKey(mine, 'builtin-key', 'glm-4.5-air', 1000)
    expect(c.model).toBe('glm-4.6')
  })

  it('没改过模型（还是代码默认值）时用下发的默认值', () => {
    // 否则 .env 的 ZHIPU_MODEL 永远不生效
    const c = applyBuiltinKey(DEFAULT_CONFIG, 'builtin-key', 'glm-4.6', 1000)
    expect(c.model).toBe('glm-4.6')
  })

  it('端点没下发模型时保持原样', () => {
    const c = applyBuiltinKey(DEFAULT_CONFIG, 'builtin-key', '', 1000)
    expect(c.model).toBe(DEFAULT_CONFIG.model)
  })
})

describe('builtinKeyState 展示状态', () => {
  it('内置 Key 生效时 active，有效期 7 天', () => {
    const c = applyBuiltinKey(DEFAULT_CONFIG, 'k', 'glm-4.5-air', 1000)
    const s = builtinKeyState(c)
    expect(s.active).toBe(true)
    expect(s.startedAt).toBe(1000)
    expect(s.expiresAt).toBe(1000 + BUILTIN_KEY_DAYS * DAY)
  })

  it('用户自己的 Key → 不 active', () => {
    const s = builtinKeyState({ ...DEFAULT_CONFIG, apiKey: 'mine', keySource: 'custom' })
    expect(s.active).toBe(false)
    expect(s.startedAt).toBeNull()
    expect(s.expiresAt).toBeNull()
  })

  it('没有 Key → 不 active', () => {
    const s = builtinKeyState({ ...DEFAULT_CONFIG, apiKey: '' })
    expect(s.active).toBe(false)
  })

  it('config 里没带 startedAt 时回退读独立 key', () => {
    stampBuiltinStarted(1000)
    const c: LLMConfig = {
      ...DEFAULT_CONFIG,
      apiKey: 'k',
      keySource: 'builtin',
      builtinStartedAt: null, // 换 Key 来回切时可能丢
    }
    const s = builtinKeyState(c)
    expect(s.startedAt).toBe(1000)
    expect(s.expiresAt).toBe(1000 + BUILTIN_KEY_DAYS * DAY)
  })
})

describe('loadConfig 兼容与迁移', () => {
  const KEY = 'atoms-demo.llm-config'

  it('空存储 → 默认配置', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('7 天已过也【不清 Key 不拦请求】—— 纯文案提示语义', () => {
    const stale: LLMConfig = {
      ...DEFAULT_CONFIG,
      apiKey: 'builtin-key',
      keySource: 'builtin',
      builtinStartedAt: Date.now() - 8 * DAY, // 早就过了 7 天
    }
    store.set(KEY, JSON.stringify(stale))
    const c = loadConfig()
    expect(c.apiKey).toBe('builtin-key') // 到期不清
    // 「已过期」只体现在文案计算上，UI 决定怎么提示
    expect(builtinKeyState(c).expiresAt!).toBeLessThan(Date.now())
  })

  it('旧版存储没有 keySource → 默认 custom', () => {
    store.set(
      KEY,
      JSON.stringify({
        baseURL: '/zhipu',
        apiKey: 'old-key',
        model: 'glm-4.5-air',
        thinking: 'disabled',
      })
    )
    expect(loadConfig().keySource).toBe('custom')
  })

  it('历史遗留：直连 bigmodel.cn 的 baseURL 悄悄改回本地代理', () => {
    store.set(
      KEY,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      })
    )
    expect(loadConfig().baseURL).toBe('/zhipu')
  })
})
