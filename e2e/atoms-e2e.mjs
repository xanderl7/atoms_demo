/**
 * Atoms-Demo 端到端自动化测试
 * 跑法：ZHIPU_API_KEY=xxx npm run test:e2e（需先 npm run dev）
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

// 等所有步骤跑完（注意第二参数是 arg，options 必须放第三位）
const waitIdle = (ms = 120000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
    timeout: ms,
  })

const sendAndWait = async (text, ms = 120000) => {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.send').click()
  await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
  await waitIdle(ms)
  await page.waitForTimeout(500)
}

await page.goto(URL, { waitUntil: 'networkidle' })

// ===== 1. 基础渲染 =====
check('页面渲染出顶栏', await page.locator('.topbar').isVisible())
check('左侧对话区可见', await page.locator('.chat').isVisible())
check('输入框可见', await page.locator('.composer textarea').isVisible())
check('初始无代码时显示空态', (await page.locator('.empty').count()) > 0)

// ===== 2. 无 Key 时不吞消息 =====
await setCfg('')
await page.locator('.composer textarea').fill('测试无key')
await page.locator('.send').click()
await page.waitForTimeout(600)
check('无 Key 时弹出设置面板', await page.locator('.modal').isVisible().catch(() => false))
check('用户消息仍然显示', (await page.locator('.bubble.user').count()) >= 1)
check(
  '有明确的填 Key 提示',
  (await page.locator('.bubble.assistant').last().innerText()).includes('API Key')
)
await page.locator('.modal .icon-btn', { hasText: '取消' }).click().catch(() => {})
await page.waitForTimeout(200)

// ===== 3. 中断功能 =====
await setCfg(KEY)
await page.locator('.composer textarea').fill('做一个复杂的企业官网，包含很多页面')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(600)
check('生成中出现停止按钮', await page.locator('.send.stop').isVisible())
await page.locator('.send.stop').click()
await page.waitForTimeout(800)
check('中断后恢复发送按钮', await page.locator('.send.stop').count() === 0)
const afterStop = await page.locator('.bubble.assistant').last().innerText()
check('中断后有明确提示', afterStop.includes('已中断'), afterStop.slice(0, 60))
check('中断后没有产生预览', (await page.locator('iframe').count()) === 0)

// ===== 4. 聊天不该生成 =====
await sendAndWait('你好')
const chatReply = await page.locator('.bubble.assistant').last().innerText()
check('说"你好"不生成应用', !chatReply.includes('已生成'), JSON.stringify(chatReply.slice(0, 50)))
check('聊天有文字回复', chatReply.trim().length > 0)
check('聊天后预览区仍为空', (await page.locator('iframe').count()) === 0)

// ===== 5. 需求澄清 + Human-in-the-loop =====
await sendAndWait('帮我做个网站')
const optCount = await page.locator('.opt').count()
check('模糊需求触发澄清选项', optCount > 0, `选项数 ${optCount}`)
check('澄清时不生成代码', (await page.locator('iframe').count()) === 0)
check(
  '提供"跳过澄清"的兜底选项',
  (await page.locator('.opt').allInnerTexts()).some((t) => t.includes('默认'))
)

const firstOpt = await page.locator('.opt').first().innerText()
await page.locator('.opt').first().click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await waitIdle(150000)
await page.waitForTimeout(1500)
check('点选项后开始生成', (await page.locator('iframe').count()) > 0, `选了「${firstOpt}」`)
check('旧轮次选项已失效', (await page.locator('.opt').count()) === 0)

const frameCount = await page.locator('iframe').count()
if (frameCount > 0) {
  const bodyText = await page.frameLocator('iframe').locator('body').innerText().catch(() => '')
  check('预览有可见内容', bodyText.trim().length > 20, JSON.stringify(bodyText.slice(0, 60)))
  check('内容是中文', /[\u4e00-\u9fa5]/.test(bodyText))
}

// ===== 6. 代码视图 =====
await page.locator('.segmented button', { hasText: '代码' }).click()
await page.waitForTimeout(400)
const codeText = await page.locator('.code').innerText().catch(() => '')
check('代码视图有源码', /<html|<!DOCTYPE/i.test(codeText))
await page.locator('.segmented button', { hasText: '预览' }).click()

// ===== 7. 迭代不再二次追问 =====
await sendAndWait('把主色调改成绿色', 150000)
check('已有版本时迭代不再追问', (await page.locator('.opt').count()) === 0)
const lastMsg2 = await page.locator('.bubble.assistant').last().innerText()
check('迭代无失败', !/生成失败/.test(lastMsg2), lastMsg2.slice(0, 80))

// ===== 8. 日志面板 =====
await page.locator('.icon-btn', { hasText: '日志' }).click()
await page.waitForTimeout(400)
check('日志面板可打开', await page.locator('.log-list').isVisible().catch(() => false))
const logRows = await page.locator('.log-row').count()
check('日志有记录', logRows > 3, `${logRows} 条`)
check(
  '日志记录了意图判定',
  (await page.locator('.log-list').innerText()).includes('intent=')
)
await page.locator('.modal .send', { hasText: '关闭' }).click().catch(() => {})
await page.waitForTimeout(300)

// ===== 9. 报错检查 =====
const realConsole = consoleErrors.filter((e) => !/favicon|React DevTools/i.test(e))
check('无 console error', realConsole.length === 0, realConsole.join(' | ').slice(0, 250))
const appErrors = pageErrors.filter(
  (e) => !/Cannot read properties of null|is not a function|undefined \(reading/.test(e)
)
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
