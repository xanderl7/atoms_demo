/**
 * 专项验证：「改回去 / 撤销 / 回退」是否真的切回上一版，而不是重新生成一份一样的
 */
import { chromium } from 'playwright'

const KEY = process.env.ZHIPU_API_KEY || ''
const URL = process.env.APP_URL || 'http://localhost:5173'
const STORE = 'atoms-demo.llm-config'
if (!KEY) {
  console.error('缺少 ZHIPU_API_KEY 环境变量')
  process.exit(2)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(
  ([k, key]) =>
    localStorage.setItem(
      k,
      JSON.stringify({ baseURL: '/zhipu', apiKey: key, model: 'glm-4.5-air', thinking: 'disabled' })
    ),
  [STORE, KEY]
)
await page.reload({ waitUntil: 'networkidle' })

const waitIdle = (ms = 150000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
    timeout: ms,
  })

// 读当前渲染的代码：切到代码视图读 <pre> 全文
const readCode = async () => {
  await page.locator('.segmented button', { hasText: '代码' }).click()
  await page.waitForTimeout(300)
  const txt = await page.locator('pre.code').innerText()
  await page.locator('.segmented button', { hasText: '预览' }).click()
  await page.waitForTimeout(200)
  return txt.replace(/^\s*\d+\s/gm, '') // 去掉行号
}

const sendAndWait = async (text, ms = 150000) => {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.send').click()
  await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
  await waitIdle(ms)
  await page.waitForTimeout(500)
}

// ---- v1 ----
await sendAndWait('做一个番茄钟网页，浅色背景，倒计时 25 分钟，可以开始暂停重置')
const v1 = await readCode()
check('v1 生成成功', v1.length > 1000, `${v1.length} 字符`)

// ---- v2（改一版）----
await sendAndWait('把主色调改成深蓝色，按钮改成圆角')
const v2 = await readCode()
check('v2 生成成功', v2.length > 1000, `${v2.length} 字符`)
check('v2 与 v1 确实不同', v1 !== v2)

// ---- 回滚 ----
const t0 = Date.now()
await page.locator('.composer textarea').fill('再改回去')
await page.locator('.send').click()
await page.waitForTimeout(1500)
const elapsed = Date.now() - t0

const reply = await page.locator('.bubble.assistant').last().innerText()
const v3 = await readCode()

check('回滚提示语出现', reply.includes('已回到第'), reply.slice(0, 60))
check('回滚是秒回（没调 LLM）', elapsed < 3000, `${elapsed}ms`)
check('回滚后代码 == v1', v3 === v1, `v3 ${v3.length} / v1 ${v1.length}`)
check('回滚后代码 != v2', v3 !== v2)

// 回滚消息自己不该带步骤条（根本没走生成流程）。
// 注意：不能数全页 .step —— 历史消息的步骤条本来就该留在那里，
// 要断言的是【回滚这一条消息】没有步骤条
const rollbackSteps = await page
  .locator('.bubble.assistant')
  .last()
  .locator('xpath=..')
  .locator('.steps')
  .count()
check('回滚没有出现步骤条', rollbackSteps === 0)

// ---- 同义说法 ----
await sendAndWait('撤销', 20000).catch(() => {})
const r2 = await page.locator('.bubble.assistant').last().innerText()
check('「撤销」同样命中回滚', r2.includes('已回到第'), r2.slice(0, 60))

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
