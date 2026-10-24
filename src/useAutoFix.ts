import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { LLMConfig } from './config'
import type { AppVersion } from './types'
import { chatStream } from './llm'
import { buildFixMessages, extractHtml, type FixIssue } from './prompts'
import { staticCheck } from './verify'
import type { IframeError } from './iframeProbe'
import { log } from './logger'

/** 最多自动修几轮。修不完就停下来如实告知，绝不无限循环烧钱 */
export const AUTO_FIX_MAX_ROUNDS = 2

/** iframe 加载后等这么久再收错误：给页面脚本执行、首屏事件触发留时间 */
const SETTLE_MS = 1600

export interface AutoFixDeps {
  cfg: LLMConfig
  /** 当前版本（自检的对象） */
  current: AppVersion | undefined
  /** 预览区探针报上来的运行时错误 */
  frameErrors: IframeError[]
  /** 用户正忙着发新消息时不插手动修，避免两个请求互相打断 */
  busy: boolean
  /** 提交修复后的新版本（加版本 + 刷新预览）。不负责重新 arm */
  commit: (code: string) => void
  /** 往当前这轮生成的助手消息里追加文字 */
  report: (text: string) => void
  setBusy: (b: boolean) => void
  /** 和「停止」按钮共用的中断控制器 */
  abortRef: MutableRefObject<AbortController | null>
}

export interface AutoFixApi {
  /** 提交新版本后调用：开始一轮自检 */
  arm: () => void
  /** 是否正在自检/修复流程中（供 UI 展示） */
  active: boolean
  round: number
}

/**
 * 自检 + 自动修复闭环。
 *
 * 要解决的问题：生成的代码经常带 bug（脚本语法错误、事件没绑上、重复 id…），
 * 而用户在预览里只看到"点了没反应"，不知道该说什么。以前只能靠用户自己发现、
 * 自己描述，再点「让 AI 修」—— 大部分用户根本发现不了。
 *
 * 现在的流程（每次提交新版本后自动跑，0 用户参与）：
 *   1. 静态检查：扫代码里的结构性硬伤（script 不配对、HTML 解析错误、
 *      重复 id、空页面、TODO 占位、表单 action、悬空选择器、jQuery 伪类）
 *      —— 不发请求，0 成本；
 *   2. 等 iframe 加载完 1.6s，收集探针报上来的真实运行时错误；
 *   3. 有问题 → 带着「完整代码 + 问题清单」回喂模型修，生成修复版；
 *   4. 修复版重新走 1-3，最多 2 轮；
 *   5. 2 轮还修不完 → 明确告诉用户"还剩哪几个问题"，不无限循环。
 */
export function useAutoFix(deps: AutoFixDeps): AutoFixApi {
  const [armed, setArmed] = useState(false)
  const [round, setRound] = useState(0)
  /** 正在修复中：防止 iframe 错误回流触发重复修复 */
  const fixingRef = useRef(false)

  // frameErrors 不能直接进 effect 依赖 —— 错误是修复过程中陆续到达的，
  // effect 跑的时候它们还不存在。用 ref 存最新值，check 时读 ref。
  // （在 effect 里同步而不是渲染期直接赋值：渲染期写 ref 会被
  //   react-hooks v7 的 refs 规则拦下，也确实有渲染纯度问题。）
  const frameErrorsRef = useRef<IframeError[]>(deps.frameErrors)
  useEffect(() => {
    frameErrorsRef.current = deps.frameErrors
  }, [deps.frameErrors])

  const arm = () => {
    setRound(0)
    setArmed(true)
  }

  useEffect(() => {
    if (!armed || !deps.current || deps.busy || fixingRef.current) return

    let cancelled = false
    // 等 iframe 加载 + 页面脚本跑起来，再一次性收问题
    const timer = setTimeout(() => {
      void check()
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }

    async function check() {
      if (cancelled || fixingRef.current || !deps.current) return
      const code = deps.current.code

      const staticIssues = staticCheck(code)
      const runtimeIssues: IframeError[] = frameErrorsRef.current.filter(
        (e) => e.kind !== 'info'
      )
      const issues: FixIssue[] = [
        ...staticIssues.map((s) => ({ message: s.message, line: s.line })),
        ...runtimeIssues.map((e) => ({ message: e.message, line: e.line })),
      ]

      // ✅ 自检通过
      if (issues.length === 0) {
        setArmed(false)
        deps.report('\n\n✅ 自检通过：页面加载后没有发现运行时错误。')
        log.info('autofix', '自检通过，无问题')
        return
      }

      // 修了 2 轮还有问题：停下来如实说，不无限循环
      if (round >= AUTO_FIX_MAX_ROUNDS) {
        setArmed(false)
        deps.report(
          `\n\n⚠️ 自检：自动修复 ${AUTO_FIX_MAX_ROUNDS} 轮后仍有 ${issues.length} 个问题，先如实告诉你，不再反复重试：\n` +
            issues.map((i) => `- ${i.message}`).join('\n') +
            '\n\n你可以点预览区报错条里的「让 AI 修」，或者直接把问题描述给我。'
        )
        log.warn('autofix', `修复 ${AUTO_FIX_MAX_ROUNDS} 轮后仍有 ${issues.length} 个问题，停止重试`)
        return
      }

      // ── 跑一轮修复 ────────────────────────────────
      fixingRef.current = true
      const thisRound = round + 1
      deps.report(
        `\n\n🔍 自检发现 ${issues.length} 个问题，正在自动修复（第 ${thisRound}/${AUTO_FIX_MAX_ROUNDS} 轮）…`
      )
      deps.setBusy(true)
      const controller = new AbortController()
      deps.abortRef.current = controller

      try {
        const raw = await chatStream(
          deps.cfg,
          buildFixMessages(code, issues),
          () => {
            /* 修复过程不逐字刷屏，只在中途报一次状态 */
          },
          0.3, // 修复是精确活，温度压低，别发挥
          controller.signal
        )
        const fixed = extractHtml(raw)
        if (!fixed || fixed.length < 50) {
          throw new Error(`修复结果不可用（长度 ${fixed.length}）`)
        }
        deps.commit(fixed)
        setRound(thisRound)
        deps.report(
          `\n\n🔧 已自动修复（第 ${thisRound}/${AUTO_FIX_MAX_ROUNDS} 轮），右侧已更新，正在重新自检…`
        )
        log.info('autofix', `第 ${thisRound} 轮修复完成`, {
          issues: issues.map((i) => i.message.slice(0, 60)),
        })
      } catch (e: unknown) {
        const err = (e ?? {}) as { name?: string; message?: string }
        if (err.name === 'AbortError') {
          setArmed(false)
          deps.report('\n\n已中断自检修复。')
          log.warn('autofix', '用户中断了修复')
        } else {
          setArmed(false)
          deps.report(
            `\n\n⚠️ 自动修复失败：${err.message}\n你可以手动把问题描述给我，或点预览区报错条里的「让 AI 修」。`
          )
          log.error('autofix', `修复失败：${err.message}`)
        }
      } finally {
        fixingRef.current = false
        deps.abortRef.current = null
        deps.setBusy(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, deps.current?.id, round, deps.busy])

  return { arm, active: armed, round }
}
