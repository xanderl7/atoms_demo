/**
 * 预览区高度链回归测试
 * 目的：确保 .preview-wrap 里的 .stage（iframe 的父盒子）能真正吃满剩余高度。
 * 之前 .stage 在纵向 flex 容器里没写 flex，高度塌成 iframe 默认 150px → 大片留白。
 */
import { chromium } from './_harness.mjs'

const URL = 'http://localhost:5173'
let pass = 0,
  fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('  [页面报错]', e.message))
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('.main', { timeout: 15000 })

// ── 1) 空状态：.empty 要占满整个预览区 ──────────────────
await page.waitForSelector('.preview-wrap', { timeout: 5000 })
let m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  const empty = document.querySelector('.preview-wrap > .empty')
  if (!wrap || !empty) return null
  return {
    wrap: Math.round(wrap.getBoundingClientRect().height),
    empty: Math.round(empty.getBoundingClientRect().height),
  }
})
ok('空状态：.empty 撑满预览区', m && Math.abs(m.wrap - m.empty) <= 2, m ? `wrap=${m.wrap} empty=${m.empty}` : '找不到节点')

// ── 2) 有代码时：.stage 必须吃满（这是本次修的 bug）──────
// 直接往真实 DOM 里塞一个 .stage + iframe，测的就是真实 CSS 链
m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  wrap.innerHTML = ''
  const stage = document.createElement('div')
  stage.className = 'stage'
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', 'allow-scripts')
  f.srcdoc = '<html><body style="margin:0;background:#3b82f6"><h1>hi</h1></body></html>'
  stage.appendChild(f)
  wrap.appendChild(stage)
  return null
})
await page.waitForTimeout(300)
m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  const stage = document.querySelector('.preview-wrap > .stage')
  const iframe = document.querySelector('.preview-wrap > .stage > iframe')
  return {
    wrap: Math.round(wrap.getBoundingClientRect().height),
    stage: Math.round(stage.getBoundingClientRect().height),
    iframe: Math.round(iframe.getBoundingClientRect().height),
  }
})
ok('有代码：.stage 吃满预览区高度', Math.abs(m.wrap - m.stage) <= 2, `wrap=${m.wrap} stage=${m.stage}`)
ok('有代码：iframe 不再塌成 150px', m.iframe > 300, `iframe=${m.iframe}`)
ok('有代码：iframe 与 .stage 同高', Math.abs(m.stage - m.iframe) <= 2, `stage=${m.stage} iframe=${m.iframe}`)

// ── 3) 出现报错条时：.stage 要让出报错条的高度，但不能塌 ──
m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  const bar = document.createElement('div')
  bar.className = 'frame-errors'
  bar.innerHTML = '<div class="fe-head"><span>预览里有 1 个运行时问题</span></div><div class="fe-item">boom</div>'
  wrap.insertBefore(bar, wrap.firstChild)
  return null
})
await page.waitForTimeout(300)
m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  const bar = document.querySelector('.frame-errors')
  const stage = document.querySelector('.preview-wrap > .stage')
  return {
    wrap: Math.round(wrap.getBoundingClientRect().height),
    bar: Math.round(bar.getBoundingClientRect().height),
    stage: Math.round(stage.getBoundingClientRect().height),
  }
})
ok('有报错条：.stage 仍占满剩余空间', Math.abs(m.wrap - m.bar - m.stage) <= 30, `wrap=${m.wrap} bar=${m.bar} stage=${m.stage}`)
ok('有报错条：报错条不会挤没 iframe', m.stage > 300, `stage=${m.stage}`)

// ── 4) 窄窗口下也不塌 ───────────────────────────────────
await page.setViewportSize({ width: 1024, height: 700 })
await page.waitForTimeout(300)
m = await page.evaluate(() => {
  const wrap = document.querySelector('.preview-wrap')
  const stage = document.querySelector('.preview-wrap > .stage')
  const bar = document.querySelector('.frame-errors')
  return {
    wrap: Math.round(wrap.getBoundingClientRect().height),
    bar: bar ? Math.round(bar.getBoundingClientRect().height) + 10 : 0, // 含上边距
    stage: Math.round(stage.getBoundingClientRect().height),
  }
})
ok(
  '窄窗口(1024x700)：.stage 仍吃满剩余空间',
  Math.abs(m.wrap - m.bar - m.stage) <= 30,
  `wrap=${m.wrap} bar=${m.bar} stage=${m.stage}`,
)

// ── 5) 左侧对话区没有被影响 ──────────────────────────────
m = await page.evaluate(() => {
  const chat = document.querySelector('.chat')
  const main = document.querySelector('.main')
  return {
    chat: Math.round(chat.getBoundingClientRect().height),
    main: Math.round(main.getBoundingClientRect().height),
  }
})
ok('左侧对话区高度与 .main 一致（布局没被带歪）', Math.abs(m.chat - m.main) <= 2, `chat=${m.chat} main=${m.main}`)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
