/**
 * 端到端：作品集生成 → 说"换成真实作品" → 必须走引导，绝不编造。
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

console.log('=== 生成一个作品集页面 ===')
// 需求要写具体，否则会被"澄清"拦下（那是另一条既定行为），这里要直接进生成流程
await page.fill(
  'textarea',
  '做一个个人摄影作品集单页：顶部导航、6 个作品卡片网格、关于我、联系表单，主色深蓝'
)
await page.click('.send')
await page.waitForSelector('.stage iframe', { timeout: 180000 })
await page.waitForTimeout(6000)

const firstCode = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
ok('生成了页面', firstCode.length > 1000, `${firstCode.length} 字符`)

console.log('\n=== 说「帮我把作品换成真实作品」===')
const beforeVersion = await page.evaluate(() => document.querySelectorAll('.msg.assistant').length)
await page.fill('textarea', '帮我把作品换成真实作品')
await page.click('.send')
await page.waitForTimeout(9000)

const bubbles = await page.evaluate(() =>
  [...document.querySelectorAll('.bubble.assistant')].map((b) => b.textContent || '')
)
const last = bubbles[bubbles.length - 1] || ''

console.log('--- 助手回复 ---')
console.log(last)
console.log('----------------')

ok('有回复', last.length > 30, `长度 ${last.length}`)
ok('说明了没有上传入口', last.includes('没有上传入口') || last.includes('收不到'), '')
ok('明确说不会编造', last.includes('不会') || last.includes('不编'), '')
ok('告诉用户自己怎么改', last.includes('代码') || last.includes('改'), '')
ok('没有残留 JSON', !last.includes('"intent"') && !last.includes('```json'), '')

// 关键：不允许产生"新的一版编造的作品"
const afterCode = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
const changed = afterCode !== firstCode
console.log(`页面是否被重新生成：${changed ? '是（不该发生）' : '否（正确）'}`)
ok('没有偷偷重新生成一版新作品', !changed, '')

ok('全程没有原生弹框', nativeDialogs.length === 0, nativeDialogs.join(' | '))

await page.screenshot({ path: '/tmp/handoff.png' })
console.log('\n截图：/tmp/handoff.png')

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
