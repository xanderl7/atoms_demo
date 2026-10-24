/**
 * 推倒重做 + 质问误判 回归测试（用户实测截图场景复现）。
 *
 * 截图里的对话流（本脚本取其核心链路）：
 *   1. "写个最简单的hello world，其他啥也不要" → 第 1 版
 *   2. "换个颜色吧，绿色" → 第 2 版（绿）
 *   3. "改回去，不喜欢这样" → 回退第 1 版
 *   4. "还是第一版" → 已在第 1 版
 *   5. "算了第二版" → 切第 2 版
 *   6. "推倒重做，出一个全新的第三版" → 【bug3】做出了跟 hello world
 *      无关的绿色泛泛网页。正确行为：从【最初的需求】出发重做，
 *      新版本预览里必须有 Hello World。
 *      【bug3b】如果恰好已存在第三版（上一轮模型直接建的），这句话
 *      还会被版本指代拦成"已经在第 3 版了，不用改"——用户要新建，
 *      系统说你已经有了。创建意图必须先于版本指代判断。
 *   7. "你这个第三版是什么东西，完全不是hello world了" →
 *      【bug4】系统回"已切到第 3 版"（用户问东它答西）。
 *      正确行为：不当成切换指令，就着质问回应（追问或直接重修）
 *
 * 跑法：ZHIPU_API_KEY=xxx node e2e/rebuild-e2e.mjs（需先 npm run dev）
 * 全程约 4-6 分钟（含 2 次真实生成）。
 */
import { chromium } from 'playwright'

const KEY = process.env.ZHIPU_API_KEY || ''
const URL = process.env.APP_URL || 'http://localhost:5173'
const STORE = 'atoms-demo.llm-config'
if (!KEY) {
  console.error('缺少 ZHIPU_API_KEY 环境变量')
  process.exit(2)
}

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

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
await page.waitForSelector('.composer textarea')

const waitIdle = (ms = 150000) =>
  page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
    timeout: ms,
  })

const sendAndWait = async (text, ms = 150000) => {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.send').click()
  await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
  await waitIdle(ms)
  await page.waitForTimeout(600)
}

const lastAssistant = () => page.locator('.bubble.assistant').last().innerText()
// iframe 会在 commit 后重建，第一次读可能撞上替换中的旧帧 —— 重试几次
const previewText = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      const t = await page.frameLocator('.stage iframe').locator('body').innerText({ timeout: 8000 })
      if (t.trim()) return t
    } catch {
      /* 重试 */
    }
    await page.waitForTimeout(800)
  }
  return ''
}

// ── 1. 最初的需求：hello world ──────────────────────────────
console.log('\n=== 1) 最初的需求 ===')
await sendAndWait('写个最简单的hello world，其他啥也不要')
const v1 = await previewText()
ok('第 1 版是 hello world', /hello\s*world/i.test(v1), v1.trim().slice(0, 40))

// ── 2. 换颜色 → 第 2 版 ────────────────────────────────────
console.log('\n=== 2) 局部改色（走 patch，不重建）===')
await sendAndWait('换个颜色吧，绿色', 120000)
const v2reply = await lastAssistant()
ok('第 2 步有生成/修改回复', v2reply.includes('已生成') || v2reply.includes('耗时') || v2reply.includes('局部修改'), v2reply.split('\n')[0].slice(0, 50))

// ── 3-5. 版本切换（截图里已验证 OK，这里保命防回归）─────────
console.log('\n=== 3-5) 回退与版本切换 ===')
await sendAndWait('改回去，不喜欢这样')
ok('「改回去」回到第 1 版', (await lastAssistant()).includes('已回到第 1 版'))
await sendAndWait('还是第一版')
ok('「还是第一版」提示已在第 1 版', (await lastAssistant()).includes('第 1 版'))
await sendAndWait('算了第二版')
ok('「算了第二版」切到第 2 版', (await lastAssistant()).includes('已切到第 2 版'))

// ── 6. 推倒重做：从最初需求出发（bug3 修复点）──────────────
// 注意：这里故意【不】先发"算了第三版！"—— 那一句模型的反应是问还是
// 直接建一辆 v3 有波动，会把状态搅乱。本脚本聚焦两个修复点本身。
console.log('\n=== 6) 推倒重做，出一个全新的第三版 ===')
await sendAndWait('推倒重做，出一个全新的第三版')
const v3text = await previewText()
ok(
  '新版本预览里有 Hello World（从最初需求出发，不是拿当前页面重画）',
  /hello\s*world/i.test(v3text),
  v3text.trim().slice(0, 60)
)
const gen6 = await lastAssistant()
ok(
  '创建请求没被版本指代拦成"已经在第 N 版，不用改"',
  !gen6.includes('不用改') && !gen6.includes('已切到') && !gen6.includes('已回到'),
  gen6.replace(/\n/g, ' ⏎ ').slice(0, 140)
)
ok('走了真实生成', gen6.includes('已生成') || gen6.includes('耗时') || gen6.includes('局部修改'), '')

// ── 7. 质问第三版：不当成切换指令（bug4 修复点）─────────────
console.log('\n=== 7) 质问：「你这个第三版是什么东西」 ===')
await sendAndWait('你这个第三版是什么东西，完全不是hello world了', 120000)
const reply7 = await lastAssistant()
ok(
  '没有误判成版本切换（不说"已切到第 N 版"）',
  !reply7.includes('已切到第') && !reply7.includes('已回到第') && !reply7.includes('不用改'),
  reply7.split('\n')[0].slice(0, 50)
)
ok('就着质问回应了（有实质回复，不是空话）', reply7.trim().length > 10, '')

// ── 收尾 ───────────────────────────────────────────────────
ok('全程没有页面级 JS 错误', pageErrors.length === 0, pageErrors[0] ?? '')

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
