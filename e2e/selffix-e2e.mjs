/**
 * 自检闭环 e2e：验证「生成完 → 自动自检」这条链路真的在跑。
 *
 * 断言三件事：
 *   1. 生成完成后，聊天区出现自检结论（✅ 自检通过 / 🔧 已自动修复 / ⚠️ 修不完如实告知）
 *   2. 预览区没有"未知错误"这种假报错
 *   3. iframe 里页面真的有内容（不是白屏）
 *
 * 注：大部分生成是干净的，所以通常断言的是「自检通过」分支；
 * 修复分支由单测（verify/prompts）+ errorbar-test 的手动修复路径覆盖。
 *
 * 跑法：ZHIPU_API_KEY=xxx node e2e/selffix-e2e.mjs（需先 npm run dev）
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
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto(URL)
await page.evaluate(
  ([k, store]) => localStorage.setItem(store, k),
  [
    JSON.stringify({
      apiKey: process.env.ZHIPU_API_KEY,
      baseURL: '/zhipu',
      model: 'glm-4.5-air',
      thinking: 'disabled',
    }),
    STORE,
  ]
)
await page.reload()
await page.waitForSelector('.composer textarea')

// 发一个具体的需求（太宽泛会走澄清分支，等不到生成）
const PROMPT = '做一个咖啡店菜单页面：顶部店名，中间按「咖啡/茶饮/甜点」分类展示菜单卡片（带价格），底部一个留言表单'
await page.fill('.composer textarea', PROMPT)
await page.click('button.send')

// 等生成结束（停止按钮变回发送按钮）。给足 240s：生成 + 最多 2 轮自检修复
await page.waitForSelector('button.send:not(.stop)', { timeout: 240000 })
console.log('生成流程结束，等待自检结论…')

// 自检结论在生成结束后约 2s 追加（要等 iframe 加载完再收错误），
// 所以必须等它出现，不能立刻读聊天记录
await page.waitForFunction(
  () => /自检通过|已自动修复|仍有 \d+ 个问题/.test(document.querySelector('.msgs')?.innerText ?? ''),
  { timeout: 60000 }
)
console.log('自检结论已出现，开始断言')

// ① 自检结论必须出现
const chatText = await page.evaluate(() => document.querySelector('.msgs').innerText)
check(
  '出现自检结论（通过/已修复/修不完如实告知）',
  /自检通过|已自动修复|仍有 \d+ 个问题/.test(chatText),
  chatText.match(/(自检通过|已自动修复|仍有 \d+ 个问题)[^\n]*/)?.[0] ?? '未找到'
)

// ② 预览区不出现"未知错误"这种假报错
const errText = await page.evaluate(() => document.querySelector('.frame-errors')?.innerText ?? '')
check('预览区没有假报错（未知错误）', !errText.includes('未知错误'), errText.slice(0, 80) || '无报错条')

// ③ iframe 里页面有实际内容
const frameText = await page.frameLocator('iframe').locator('body').innerText()
check('iframe 页面有实际内容', frameText.trim().length > 30, `${frameText.trim().length} 字符`)

// ④ 代码视图能打开且非空（预览/代码常驻切换不该白屏）
await page.click('.segmented button:has-text("代码")')
await page.waitForTimeout(300)
const codeLen = await page.evaluate(() => document.querySelector('.code-wrap')?.innerText.length ?? 0)
check('代码视图有内容', codeLen > 200, `${codeLen} 字符`)

await browser.close()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
