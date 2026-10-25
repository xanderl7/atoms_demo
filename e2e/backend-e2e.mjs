/**
 * 端到端：用户说「帮我做后端」时，不能一边反问一边生成。
 *
 * 用户截图：助手气泡显示
 *   "- 你想做后端应用，但具体要实现什么功能还不清楚，你主要想用后端来做什么？"
 *   "正在生成代码... 5861 字符"
 * 一边问一边干 —— 用户还没回答，页面已经生成完了。
 *
 * 目标：
 *   1. 要么停下来问（带选项，不生成）
 *   2. 要么直接做前端示意版（不反问）
 *   两种都算对，唯独"反问 + 同时生成"是 bug。
 */
import { chromium } from './_harness.mjs'
import fs from 'node:fs'

const KEY = (process.env.ZHIPU_API_KEY || '').trim() || fs.readFileSync(new URL('./zhipu-key.txt', import.meta.url), 'utf8').trim()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const nativeDialogs = []
page.on('dialog', async (d) => {
  nativeDialogs.push(d.message())
  await d.dismiss().catch(() => {})
})

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

console.log('=== 说「帮我做后端」===')
await page.fill('textarea', '帮我做后端')
await page.click('.send')

// 等生成结束：停止按钮消失（变回"发送"）才算完。固定 sleep 不可靠 ——
// 这次模型吐了 3 万多字符，75s 还没完
await page
  .waitForSelector('button.send:not(.stop)', { timeout: 300000 })
  .catch(() => console.log('  （等待超时，按当前状态断言）'))
await page.waitForTimeout(2000)

const bubbles = await page.evaluate(() =>
  [...document.querySelectorAll('.bubble.assistant')].map((b) => b.textContent || '')
)
const last = bubbles[bubbles.length - 1] || ''
const hasIframe = await page.evaluate(() => !!document.querySelector('.stage iframe'))

console.log('--- 助手回复（截取）---')
console.log(last.slice(0, 400))
console.log('--- 是否生成了页面：' + (hasIframe ? '是' : '否') + ' ---')

const asked = /(吗|呢|哪些|什么|怎么|如何|要不要|能不能)[？?]/.test(last)
const generated = /正在生成代码|已生成/.test(last)

// 关键断言：不能"又问又生成"
if (asked && generated) {
  ok('没有"一边问一边生成"', false, '既反问了又生成了 —— 这就是截图里的 bug')
} else if (asked && !generated) {
  ok('停下来问了，没生成', true, '行为正确')
  const opts = await page.evaluate(() => document.querySelectorAll('.options .opt').length)
  ok('给了可点的选项', opts > 0, `${opts} 个`)
} else if (!asked && generated) {
  ok('没反问，直接做了前端示意版', true, '行为正确')
  const code = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
  ok('生成了可运行的页面', code.length > 1000, `${code.length} 字符`)
} else {
  ok('有明确回复', last.length > 20, `长度 ${last.length}`)
}

// 聊天区不该残留原始 JSON
ok('没有残留 JSON', !last.includes('"intent"') && !last.includes('```json'), '')
ok('全程没有原生弹框', nativeDialogs.length === 0, nativeDialogs.join(' | '))

await page.screenshot({ path: '/tmp/backend.png' })
console.log('\n截图：/tmp/backend.png')

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
