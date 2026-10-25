import { useEffect } from 'react'
import type { LLMConfig } from './config'
import { applyBuiltinKey, saveConfig } from './config'
import { log } from './logger'

/**
 * setCfg 支持直接传值或传 updater（useState 的 setter 两种都吃）。
 * 这里用 updater：异步回调里要用「最新的」cfg，不能拿 effect 闭包里的旧值。
 */
export function useBuiltinKey(
  cfg: LLMConfig,
  setCfg: (update: LLMConfig | ((prev: LLMConfig) => LLMConfig)) => void
) {
  const { apiKey, keySource } = cfg

  useEffect(() => {
    // 已经有 Key（内置的或自己的）就不打扰
    if (apiKey) return

    let cancelled = false
    fetch('/api/builtin-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { apiKey?: string; model?: string } | null) => {
        if (cancelled || !data?.apiKey) return
        setCfg((prev) => {
          if (prev.apiKey) return prev // 期间用户自己填上了，以用户为准
          // 模型选择逻辑都在 applyBuiltinKey 里：用户改过的保留，没改过用下发的
          const next = applyBuiltinKey(prev, data.apiKey!, data.model ?? '')
          saveConfig(next)
          log.info('config', '已启用内置体验 Key', { model: next.model })
          return next
        })
      })
      .catch(() => {
        /* 静态部署没有这个端点 —— 静默，设置面板会引导用户填自己的 Key */
      })
    return () => {
      cancelled = true
    }
    // apiKey 变化时重跑：用户清掉 Key 后重新要一把内置的
  }, [apiKey, keySource, setCfg])
}
