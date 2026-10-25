/**
 * 内置体验 Key 端到端验收（作业提交「开箱即用」核心路径）。
 *
 * 验证：
 *   0. dev server 的 /api/builtin-key 端点能下发 Key（前置条件）
 *   1. 全新浏览器打开 → 内置 Key 自动生效（顶栏胶囊 + 配置落盘）
 *   2. 不弹设置面板，直接能生成（开箱即用的承诺）
 *   3. 设置面板显示「7 天文案」提示（只提示，不拦截）
 *   4. 输入框（API Key / Base URL / 模型）全部 disabled 禁止编辑；
 *      思维链下拉仍可选择（演示锁定策略：防他人改坏，但保留可调项）
 *   （已移除：覆盖自己的 Key、重置、清空回退 —— 现统一锁定内置体验 Key）
 *   5. 内置 Key 不进任何前端资源（不进 bundle）
 *
 * 前置：npm run dev 已在跑，且 .env 配了 ZHIPU_API_KEY。
 */
import { chromium } from './_harness.mjs'

const URL = process.env.APP_URL || 'http://localhost:5173'
const ENDPOINT = '/api/builtin-key'
const STORE = 'atoms-demo.llm-config'
const STARTED = 'atoms-demo.builtin-started'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

const readCfg = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE)

// 等所有步骤跑完
const waitIdle = (ms = 180000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
    timeout: ms,
  })

// ===== 0. 端点前置条件 =====
const ep = await page.request.get(URL + ENDPOINT)
const epData = ep.ok() ? await ep.json() : {}
check('端点 /api/builtin-key 下发内置 Key', !!epData.apiKey, epData.apiKey ? '已配置' : '空 —— dev server 的 .env 里没有 ZHIPU_API_KEY')
if (!epData.apiKey) {
  console.error('\n前置条件不满足：dev server 没有内置 Key。')
  console.error('在 .env 里配上 ZHIPU_API_KEY 后重启 npm run dev 再跑本测试。')
  await browser.close()
  process.exit(2)
}

// ===== 1. 开箱即用：全新浏览器打开就带 Key =====
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.key-chip', { timeout: 10000 })
check('顶栏出现「体验 Key · 7 天」胶囊', true)

const cfg1 = await readCfg()
check('配置落盘 keySource=builtin', cfg1?.keySource === 'builtin')
check('API Key 已自动填入', !!cfg1?.apiKey)
check('内置 Key 与端点下发的一致', cfg1?.apiKey === epData.apiKey)
const started1 = await page.evaluate((k) => localStorage.getItem(k), STARTED)
check('首次使用时间已独立记录', started1 !== null && Number.isFinite(Number(started1)))

// ===== 2. 不弹设置，直接能生成 =====
await page.locator('.composer textarea').fill('做一个 hello world 页面')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await waitIdle()
await page.waitForTimeout(800)
check('生成过程没有弹出设置面板', (await page.locator('.modal').count()) === 0)
check('内置 Key 直接产出了预览', (await page.locator('iframe').count()) > 0)
const genMsg = await page.locator('.bubble.assistant').last().innerText().catch(() => '')
check('生成结果无失败提示', !/生成失败/.test(genMsg), genMsg.slice(0, 120))
const bodyText = await page.frameLocator('iframe').locator('body').innerText().catch(() => '')
check('预览有可见内容', bodyText.trim().length > 5, JSON.stringify(bodyText.slice(0, 50)))

// ===== 3. 设置面板的 7 天文案（只提示）=====
await page.locator('.key-chip').click()
await page.waitForSelector('.modal')
const modalText = await page.locator('.modal').innerText()
check('显示「正在使用内置体验 Key」', modalText.includes('正在使用内置体验 Key'))
check('显示有效期 7 天文案', /有效期\s*7\s*天/.test(modalText))
check('显示截止日期', /至\s*20\d\d-\d\d-\d\d/.test(modalText))
check('不再出现「用我自己的 Key」按钮', modalText.includes('用我自己的 Key') === false)

// ===== 4. 输入框锁定，禁止编辑；思维链下拉仍可选 =====
const inputsLocked = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.modal input')]
  return inputs.length > 0 && inputs.every((i) => i.disabled)
})
check('API Key / Base URL / 模型 输入框均为 disabled（禁止编辑）', inputsLocked)
const selectEditable = await page.evaluate(() => {
  const s = [...document.querySelectorAll('.modal select')]
  return s.length > 0 && s.every((x) => !x.disabled)
})
check('思维链下拉仍可选择（未禁用）', selectEditable)
await page.locator('.modal .icon-btn', { hasText: '取消' }).click()
await page.waitForTimeout(200)

// ===== 5. 内置 Key 不进任何前端资源 =====
const leaked = await page.evaluate(async (key) => {
  const urls = [
    document.documentElement.outerHTML,
    ...[...document.querySelectorAll('script[src]')].map((s) => s.src),
  ]
  for (const u of urls) {
    const txt = u.startsWith('http') ? await (await fetch(u)).text() : u
    if (txt.includes(key)) return true
  }
  return false
}, epData.apiKey)
check('内置 Key 不在任何前端资源里（不进 bundle）', !leaked)

// ===== 收尾检查 =====
const realConsole = consoleErrors.filter((e) => !/favicon|React DevTools/i.test(e))
check('无 console error', realConsole.length === 0, realConsole.join(' | ').slice(0, 250))
check('应用本身无 pageerror', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 250))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) {
  console.log('失败项：')
  failed.forEach((f) => console.log(' -', f.name, f.detail ? '→ ' + f.detail : ''))
  process.exit(1)
}
