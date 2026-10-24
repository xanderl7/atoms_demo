import { describe, it, expect } from 'vitest'
import { ERROR_PROBE_SOURCE } from '../iframeProbe'

/**
 * 探针的单元测试。
 *
 * 探针是一段注入到 iframe 里的 JS 源码，直接 eval 它、用桩对象
 * 模拟 window/parent/document，然后手工触发各种事件，
 * 验证错误分类逻辑：
 *   ✅ JS 运行时错误 → 上报
 *   ✅ <script> 解析失败（语法错误）→ 上报
 *   ❌ 图片等资源加载失败 → 不上报（以前误报成"未知错误"的根因）
 */
function loadProbe() {
  const sent: Array<{ __atomsProbe: number; kind: string; message: string; extra: unknown }> = []
  const handlers: Record<string, Array<(e: unknown) => void>> = {}
  const created: unknown[] = []

  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      ;(handlers[type] ??= []).push(fn)
    },
  }
  const doc = {
    body: { appendChild: () => {} },
    documentElement: {},
    createElement: () => {
      const el = {
        style: {} as Record<string, string>,
        setAttribute: () => {},
        appendChild: () => {},
      }
      created.push(el)
      return el
    },
  }
  const parent = { postMessage: (d: never) => sent.push(d) }

  // 把探针源码当函数体跑起来，window/parent/document 全部用桩
  new Function('window', 'parent', 'document', ERROR_PROBE_SOURCE)(win, parent, doc)

  const fire = (type: string, e: unknown) => (handlers[type] ?? []).forEach((f) => f(e))
  return { sent, win, fire, created }
}

describe('iframe 探针错误分类', () => {
  it('JS 运行时错误 → 上报', () => {
    const { sent, win, fire } = loadProbe()
    fire('error', {
      target: win,
      message: 'x is not defined',
      filename: 'inline',
      lineno: 12,
      error: null,
    })
    expect(sent.length).toBe(1)
    expect(sent[0].kind).toBe('error')
    expect(sent[0].message).toBe('x is not defined')
  })

  it('<script> 解析失败（语法错误）→ 上报（以前被漏掉的那类）', () => {
    const { sent, fire } = loadProbe()
    fire('error', { target: { tagName: 'SCRIPT', src: '' }, message: '' })
    expect(sent.length).toBe(1)
    expect(sent[0].message).toContain('解析失败')
  })

  it('图片加载失败 → 不上报（资源错误不是 JS 错误）', () => {
    const { sent, fire } = loadProbe()
    fire('error', { target: { tagName: 'IMG', src: 'https://picsum.photos/x.png' }, message: '' })
    expect(sent.length).toBe(0)
  })

  it('link 样式加载失败 → 不上报', () => {
    const { sent, fire } = loadProbe()
    fire('error', { target: { tagName: 'LINK', href: 'https://cdn/x.css' }, message: '' })
    expect(sent.length).toBe(0)
  })

  it('Promise 未捕获异常 → 上报', () => {
    const { sent, fire } = loadProbe()
    fire('unhandledrejection', { reason: new Error('boom') })
    expect(sent.length).toBe(1)
    expect(sent[0].message).toBe('boom')
  })

  it('alert 被换成页面内 toast，不再弹原生框', () => {
    const { win, created } = loadProbe()
    expect(typeof win.alert).toBe('function')
    ;(win.alert as (m: string) => void)('你好')
    expect(created.length).toBe(1) // 创建了一个 toast 元素
  })
})
