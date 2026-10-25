/**
 * 端到端实测「作品集」场景 —— 用户报的 4 个问题一起验：
 *   1. 澄清需求时，说"作品集展示页"这种宽泛词，必须继续问而不是直接开干
 *   2. 不能编造看起来很真的假作品
 *   3. 联系表单必须能用（点了有反应）
 *   4. 必须给出完整的边界说明
 */
import { chromium } from './_harness.mjs'

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
const frameLogs = []
page.on('console', (m) => {
  if (m.type() === 'error') frameLogs.push(m.text())
})

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

const idle = (ms = 200000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
    timeout: ms,
  })

const send = async (t, ms = 200000) => {
  await page.locator('.composer textarea').fill(t)
  await page.locator('.send').click()
  await page.waitForSelector('.step.running', null, { timeout: 20000 }).catch(() => {})
  await idle(ms)
  await page.waitForTimeout(700)
}

const lastMsg = () => page.locator('.bubble.assistant').last().innerText()

// ---- 第 1 轮：宽泛需求 ----
await send('做个网页吧')
const m1 = await lastMsg()
// 澄清 = 助手在反问（含问号）且没开始生成
const isAsking = (s) => /[？?]/.test(s) && !/已生成|正在生成/.test(s)
check('第1轮：宽泛需求触发澄清', isAsking(m1), m1.slice(0, 60))

// ---- 第 2 轮：还是宽泛词「作品集展示页」----
await send('作品集展示页')
const m2 = await lastMsg()
const hasCode = await page.locator('pre.code').count()
const stillAsking = isAsking(m2)

console.log('\n--- 第2轮助手回复 ---')
console.log(m2.slice(0, 400))
console.log('---')

check(
  '第2轮：宽泛词「作品集展示页」继续追问（不再直接开干）',
  stillAsking,
  stillAsking ? '' : `看起来直接生成了：${m2.slice(0, 60)}`
)
check('第2轮：没有生成代码', hasCode === 0)

// ---- 第 3 轮：给具体内容 ----
await send('展示 3 个设计作品，极简黑白风，要有联系表单和关于我', 240000)
const m3 = await lastMsg()

console.log('\n--- 第3轮助手回复 ---')
console.log(m3.slice(0, 900))
console.log('---')

check('第3轮：给出边界说明', /这一版我要跟你说明白/.test(m3), '')
check('边界说明含「我没做到」', /我没做到/.test(m3))
check('边界说明含「你后续接手」', /你后续接手/.test(m3))

// ---- 看生成的代码质量 ----
await page.locator('.segmented button', { hasText: '代码' }).click()
await page.waitForTimeout(400)
const code = (await page.locator('pre.code').innerText()).replace(/^\s*\d+\s/gm, '')

console.log(`\n代码长度：${code.length} 字符`)

// 编造检测：不能出现看起来很真的假作品名
const fakePatterns = [
  /山隐|星轨|潮汐|云栖|拾光|未名/, // 看起来像真项目的名字
]
const hasFake = fakePatterns.some((r) => r.test(code))
check('没有编造看起来很真的作品名', !hasFake, hasFake ? code.match(fakePatterns[0])?.[0] : '')

const hasPlaceholderMark = /data-placeholder="text"/.test(code)
const hasGenericTitle = /作品标题|作品\s*[123]|待替换|项目名称/.test(code)
check('占位文案有标记 或 用了明显占位标题', hasPlaceholderMark || hasGenericTitle,
  hasPlaceholderMark ? '有 data-placeholder 标记' : (hasGenericTitle ? '用了通用占位标题' : '两者都没有'))

// 表单可用性
const hasForm = /<form/i.test(code)
if (hasForm) {
  const hasSubmitHandler = /addEventListener\(\s*['"]submit['"]/.test(code) || /onsubmit/i.test(code)
  const hasPrevent = /preventDefault\(\)/.test(code)
  const hasDomReady = /DOMContentLoaded/.test(code) || /<\/body>\s*<script|<\/body>[\s\S]*$/.test(code)
  check('表单有 submit 处理器', hasSubmitHandler)
  check('表单有 preventDefault（不刷新页面）', hasPrevent)
  check('JS 包在 DOMContentLoaded 里', hasDomReady)
  check('没有 form action 外链', !/<form[^>]*action=/i.test(code))
} else {
  check('有表单（需求里要求了联系表单）', false)
}

// 真去点一下表单，看有没有反应
await page.locator('.segmented button', { hasText: '预览' }).click()
await page.waitForTimeout(600)
const frame = page.frameLocator('iframe[title="preview"]')
try {
  const nameInput = frame.locator('form input').first()
  await nameInput.fill('张三', { timeout: 8000 })
  const btn = frame.locator('form button').first()
  await btn.click({ timeout: 8000 })
  await page.waitForTimeout(1200)
  const bodyText = await frame.locator('body').innerText()
  const reacted = /收到|成功|已提交|感谢|留言|谢谢/.test(bodyText)
  check('点提交后页面有反馈（不是点了没反应）', reacted, reacted ? bodyText.slice(0, 80) : '页面没有出现任何反馈文案')
} catch (e) {
  check('点提交后页面有反馈（不是点了没反应）', false, `交互失败：${e.message.slice(0, 80)}`)
}

// 运行时错误
const errCount = await page.locator('.frame-errors').count()
check('预览区没有运行时报错', errCount === 0, errCount ? '有报错条' : '')

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
