/**
 * Atoms-Demo 端到端自动化测试
 * 跑法：cd <node-workspace> && node atoms-e2e.mjs
 * 前提：npm run dev 已在 5173 运行
 */
import { chromium } from 'playwright'

// Key 从环境变量读，不要写进代码里：
//   ZHIPU_API_KEY=xxx npm run test:e2e
const KEY = process.env.ZHIPU_API_KEY || ''
const URL = process.env.APP_URL || 'http://localhost:5173'
if (!KEY) {
  console.error('缺少 ZHIPU_API_KEY 环境变量')
  process.exit(2)
}
const STORE = 'atoms-demo.llm-config'

const log = (...a) => console.log('[test]', ...a)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
const warn = (name, detail) => log(`⚠️  ${name}${detail ? ' — ' + detail : ''}`)

const browser = await chromium.launch()
const page = await browser.newPage()

const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

const setCfg = async (apiKey) => {
  await page.evaluate(
    ([k, key]) =>
      localStorage.setItem(
        k,
        JSON.stringify({ baseURL: '/zhipu', apiKey: key, model: 'glm-4.5-air', thinking: 'disabled' })
      ),
    [STORE, apiKey]
  )
  await page.reload({ waitUntil: 'networkidle' })
}

await page.goto(URL, { waitUntil: 'networkidle' })

// ===== 用例 1：基础渲染 =====
check('页面渲染出顶栏', await page.locator('.topbar').isVisible())
check('左侧对话区可见', await page.locator('.chat').isVisible())
check('输入框可见', await page.locator('.composer textarea').isVisible())
check('初始无代码时显示空态', (await page.locator('.empty').count()) > 0)

// ===== 用例 2：无 Key 时不吞消息 =====
await setCfg('')
await page.locator('.composer textarea').fill('测试无key')
await page.locator('.send').click()
await page.waitForTimeout(600)
check('无 Key 时弹出设置面板', await page.locator('.modal').isVisible().catch(() => false))
check('用户消息仍然显示（不被吞掉）', (await page.locator('.bubble.user').count()) >= 1)
check('有明确的填 Key 提示', (await page.locator('.bubble.assistant').last().innerText()).includes('API Key'))
await page.locator('.modal .icon-btn', { hasText: '取消' }).click().catch(() => {})
await page.waitForTimeout(200)

// ===== 用例 3：意图路由 —— 聊天不该生成页面 =====
await setCfg(KEY)
await page.locator('.composer textarea').fill('你好')
await page.locator('.send').click()
// 等等待态结束（发送按钮清空输入后始终是 disabled，不能拿它判断）
const waitIdle = (ms = 90000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, {
    timeout: ms,
  })

await page.waitForSelector('.step.running', { timeout: 15000 }).catch(() => {})
await waitIdle(90000)
await page.waitForTimeout(800)
const chatReply = await page.locator('.bubble.assistant').last().innerText()
check('说"你好"时不生成应用', !chatReply.includes('已生成'), JSON.stringify(chatReply.slice(0, 60)))
check('聊天有文字回复', chatReply.trim().length > 0)
check('聊天后预览区仍为空态', (await page.locator('iframe').count()) === 0)

// ===== 用例 4：完整生成流程 =====
const PROMPT = '做一个番茄钟：25分钟倒计时，可以开始、暂停、重置'
await page.locator('.composer textarea').fill(PROMPT)
await page.locator('.send').click()

await page.waitForSelector('.bubble.user', { timeout: 5000 })
check('用户消息立即显示', (await page.locator('.bubble.user').count()) >= 1)

// 生成中要出现「已等待 Xs」，否则用户会以为卡死
await page.waitForTimeout(1200)
const runningText = await page.locator('.msgs').innerText().catch(() => '')
check('生成中显示已等待秒数', /已等待\s*\d+s/.test(runningText), runningText.slice(-60))

await page.waitForSelector('.step', { timeout: 5000 })
check('出现步骤条（3 步）', (await page.locator('.step').count()) >= 3)

let done = false
try {
  await waitIdle(180000)
  done = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.step')]
    return s.length >= 3 && s.every((x) => x.classList.contains('done'))
  })
} catch {}
check('三步流程全部完成', done)

const lastMsg = await page.locator('.bubble.assistant').last().innerText().catch(() => '')
check('助手有回复内容', lastMsg.trim().length > 0)
check('回复不是失败信息', !/生成失败|请求发不出去/.test(lastMsg), lastMsg.slice(0, 120))

// ===== 用例 4：预览渲染 =====
await page.waitForTimeout(1500)
const frameCount = await page.locator('iframe').count()
check('预览区出现 iframe', frameCount > 0)
if (frameCount > 0) {
  const bodyText = await page.frameLocator('iframe').locator('body').innerText().catch(() => '')
  check('iframe 内渲染出内容', bodyText.trim().length > 0, JSON.stringify(bodyText.slice(0, 60)))
  check('内容符合需求（番茄钟）', /25:00|番茄|开始|重置/.test(bodyText))
}

// ===== 用例 5：沙箱存储兜底 =====
check(
  '无沙箱 localStorage 报错',
  !pageErrors.some((e) => /sandboxed|localStorage/.test(e)),
  pageErrors.filter((e) => /sandboxed|localStorage/.test(e))[0] || ''
)

// ===== 用例 6：代码视图 =====
await page.locator('.segmented button', { hasText: '代码' }).click()
await page.waitForTimeout(400)
const codeText = await page.locator('.code').innerText().catch(() => '')
check('代码视图有源码', /<html|<!DOCTYPE/i.test(codeText))
await page.locator('.segmented button', { hasText: '预览' }).click()

// ===== 用例 7：多轮迭代 =====
await page.locator('.composer textarea').fill('把主色调改成绿色')
await page.locator('.send').click()
let iterDone = false
try {
  await waitIdle(180000)
  iterDone = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.step')].slice(-3)
    return s.length === 3 && s.every((x) => x.classList.contains('done'))
  })
} catch {}
check('第二轮迭代完成', iterDone)
const lastMsg2 = await page.locator('.bubble.assistant').last().innerText().catch(() => '')
check('第二轮无失败', !/生成失败/.test(lastMsg2), lastMsg2.slice(0, 100))

// ===== 用例 8：报错检查 =====
const realConsole = consoleErrors.filter((e) => !/favicon|React DevTools/i.test(e))
check('无 console error', realConsole.length === 0, realConsole.join(' | ').slice(0, 250))

// 生成代码自身的 bug 归为警告，不算应用 bug
const appErrors = pageErrors.filter(
  (e) => !/Cannot read properties of null|is not a function|undefined \(reading/.test(e)
)
if (pageErrors.length !== appErrors.length) {
  warn('生成页面内部有 JS 报错（模型代码问题，非本应用 bug）', pageErrors.join(' | ').slice(0, 160))
}
check('应用本身无 pageerror', appErrors.length === 0, appErrors.join(' | ').slice(0, 250))

await page.screenshot({ path: '/tmp/atoms-e2e.png' })
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) {
  console.log('失败项：')
  failed.forEach((f) => console.log(' -', f.name, f.detail ? '→ ' + f.detail : ''))
  process.exit(1)
}
