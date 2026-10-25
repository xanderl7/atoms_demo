/**
 * 内置体验 Key 端到端验收（作业提交「开箱即用」核心路径）。
 *
 * 验证：
 *   0. dev server 的 /api/builtin-key 端点能下发 Key（前置条件）
 *   1. 全新浏览器打开 → 内置 Key 自动生效（顶栏胶囊 + 配置落盘）
 *   2. 不弹设置面板，直接能生成（开箱即用的承诺）
 *   3. 设置面板显示「7 天文案」提示（只提示，不拦截）
 *   4. 覆盖 API Key 输入框 → 切自己的 Key（互不影响）
 *   5. 「重置」恢复默认态（内置 Key 重新向服务端要回来并填上）
 *   6. 清空 Key 保存 → 自动回退内置 Key，且 7 天起算时间不续期
 *   7. 内置 Key 不进任何前端资源（不进 bundle）
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

// ===== 3. 设置面板的 7 天文案（只提示） =====
await page.locator('.key-chip').click()
await page.waitForSelector('.modal')
const modalText = await page.locator('.modal').innerText()
check('显示「正在使用内置体验 Key」', modalText.includes('正在使用内置体验 Key'))
check('显示有效期 7 天文案', /有效期\s*7\s*天/.test(modalText))
check('显示截止日期', /至\s*20\d\d-\d\d-\d\d/.test(modalText))
check('不再出现「用我自己的 Key」按钮', modalText.includes('用我自己的 Key') === false)

// ===== 4. 切自己的 Key（直接在输入框覆盖即可）=====
await page.locator('.modal label', { hasText: 'API Key' }).locator('input').fill('my-own-test-key')
await page.locator('.modal .send', { hasText: '保存' }).click()
await page.waitForTimeout(400)
check('切自己 Key 后顶栏胶囊消失', (await page.locator('.key-chip').count()) === 0)
const cfg2 = await readCfg()
check('keySource=custom', cfg2?.keySource === 'custom')
check('自己的 Key 已保存', cfg2?.apiKey === 'my-own-test-key')
await page.locator('.icon-btn[title="模型设置"]').click()
await page.waitForSelector('.modal')
check(
  '自己 Key 时不再显示「正在使用内置体验 Key」提示',
  (await page.locator('.modal').innerText()).includes('正在使用内置体验 Key') === false
)
await page.locator('.modal .icon-btn', { hasText: '取消' }).click()
await page.waitForTimeout(200)

// ===== 5. 「重置」恢复默认态（内置 Key 重新填上）=====
await page.locator('.icon-btn[title="模型设置"]').click()
await page.waitForSelector('.modal')
await page.locator('.modal .icon-btn', { hasText: '重置' }).click()
// 重置成功后 API Key 框会被重新填回内置 Key（见 Settings.resetToDefault）。
// 这是「恢复默认态」的真实信号；成功文案已按需求删除，不再依赖 .test-result。
await page.waitForFunction(
  (key) => {
    const inputs = [...document.querySelectorAll('.modal label input')]
    const keyInput = inputs.find((i) => i.type === 'password')
    return !!keyInput && keyInput.value === key
  },
  epData.apiKey,
  { timeout: 10000 }
)
const resetKeyVal = await page
  .locator('.modal label', { hasText: 'API Key' })
  .locator('input')
  .inputValue()
check('重置后 API Key 框里已填回内置 Key', resetKeyVal === epData.apiKey, `len=${resetKeyVal.length}`)
await page.locator('.modal .send', { hasText: '保存' }).click()
await page.waitForTimeout(400)
check('重置保存后顶栏胶囊回来', (await page.locator('.key-chip').count()) === 1)
const cfg3 = await readCfg()
check(
  '重置后 keySource=builtin 且 Key 与端点一致',
  cfg3?.keySource === 'builtin' && cfg3?.apiKey === epData.apiKey,
  `keySource=${cfg3?.keySource} key一致=${cfg3?.apiKey === epData.apiKey}`
)

// ===== 6. 清空 Key 保存 → 自动回退内置，且不续期 =====
await page.locator('.icon-btn[title="模型设置"]').click()
await page.waitForSelector('.modal')
await page.locator('.modal label', { hasText: 'API Key' }).locator('input').fill('')
await page.locator('.modal .send', { hasText: '保存' }).click()
await page.waitForSelector('.key-chip', { timeout: 10000 })
check('清空保存后自动回退内置 Key', (await page.locator('.key-chip').count()) === 1)
const started2 = await page.evaluate((k) => localStorage.getItem(k), STARTED)
check('7 天起算时间不变（切来切去不续期）', started2 === started1, `${started1} → ${started2}`)

// ===== 7. 内置 Key 不进任何前端资源 =====
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
