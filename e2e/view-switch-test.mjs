/**
 * 预览/代码切换测试。
 *
 * Bug：切换时页面会闪。
 * 根因：原来是 {view === 'preview' ? <PreviewPane/> : <CodePane/>}，
 * 一切换就卸载 iframe —— 切回预览时 iframe 重建、页面重新加载，白屏闪一下。
 * 修：两个视图都常驻挂载，用 hidden 属性切换显隐。
 *
 * 判据：给 iframe 节点打标记，切走再切回，标记还在说明节点没被重建。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const KEY = fs.readFileSync(new URL('./zhipu-key.txt', import.meta.url), 'utf8').trim()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.evaluate((k) => {
  localStorage.setItem(
    'atoms-demo.llm-config',
    JSON.stringify({ apiKey: k, baseURL: '/zhipu', model: 'glm-4.5-air' }),
  )
}, KEY)
await page.reload({ waitUntil: 'networkidle' })

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

const switchTo = async (label) => {
  await page.click(`.segmented button:has-text("${label}")`)
  await page.waitForTimeout(500)
}

console.log('=== 生成一个页面 ===')
await page.fill('textarea', '做一个咖啡店单页落地页，含顶部导航、3 个区块和页脚')
await page.click('.send')
await page.waitForSelector('.stage iframe', { timeout: 240000 })
await page.waitForTimeout(4000)
ok('页面生成了', true)

console.log('\n=== 切换不重建 iframe（闪屏的根因）===')
// 给 iframe 打标记。React 重渲染不会重置 DOM 属性，节点被重建才会丢
await page.evaluate(() => {
  const f = document.querySelector('.stage iframe')
  if (f) f.setAttribute('data-keep-marker', '1')
})
// 同时在 iframe 内部写个全局变量，重建必然丢
await page.evaluate(() => {
  const f = document.querySelector('.stage iframe')
  if (f?.contentWindow) f.contentWindow.__keepMe = 'alive'
})

await switchTo('代码')
const codeVisible = await page.evaluate(() => {
  const cw = document.querySelector('.code-wrap')
  const pw = document.querySelector('.preview-wrap')
  return {
    codeShown: !!cw && !cw.hidden,
    previewHidden: !!pw && pw.hidden,
    hasCode: !!document.querySelector('.code-wrap .code'),
  }
})
ok('切到代码：代码视图可见', codeVisible.codeShown, JSON.stringify(codeVisible))
ok('切到代码：预览视图已隐藏', codeVisible.previewHidden)
ok('切到代码：代码内容渲染出来了', codeVisible.hasCode)

await switchTo('预览')
const marker = await page.evaluate(() => {
  const f = document.querySelector('.stage iframe')
  if (!f) return { exists: false }
  return {
    exists: true,
    domMarker: f.getAttribute('data-keep-marker'),
    jsMarker: f.contentWindow?.__keepMe ?? null,
  }
})
ok('切回预览：iframe 还在', marker.exists)
ok('切回预览：DOM 节点没被重建（标记还在）', marker.domMarker === '1', `标记=${marker.domMarker}`)
ok('切回预览：iframe 内部状态没丢（没重新加载）', marker.jsMarker === 'alive', `变量=${marker.jsMarker}`)

console.log('\n=== 高度链没被带坏 ===')
const h = await page.evaluate(() => {
  const area = document.querySelector('.stage-area')
  const wrap = document.querySelector('.preview-wrap')
  const stage = document.querySelector('.stage')
  const f = document.querySelector('.stage iframe')
  return {
    area: Math.round(area.getBoundingClientRect().height),
    wrap: Math.round(wrap.getBoundingClientRect().height),
    stage: Math.round(stage.getBoundingClientRect().height),
    iframe: Math.round(f.getBoundingClientRect().height),
  }
})
ok('.stage-area 撑满第二列', h.area > 500, `高 ${h.area}`)
ok('.preview-wrap 撑满', Math.abs(h.area - h.wrap) <= 2, `area=${h.area} wrap=${h.wrap}`)
ok('.stage 撑满', Math.abs(h.wrap - h.stage) <= 2, `wrap=${h.wrap} stage=${h.stage}`)
ok('iframe 撑满', Math.abs(h.stage - h.iframe) <= 2, `stage=${h.stage} iframe=${h.iframe}`)

console.log('\n=== 连续来回切多次都稳定 ===')
for (let i = 0; i < 3; i++) {
  await switchTo('代码')
  await switchTo('预览')
}
const still = await page.evaluate(() => {
  const f = document.querySelector('.stage iframe')
  return !!f && f.getAttribute('data-keep-marker') === '1' && f.contentWindow?.__keepMe === 'alive'
})
ok('连切 6 次 iframe 仍未重建', still)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
