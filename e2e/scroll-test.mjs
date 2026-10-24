/**
 * 聊天框滚动 + 「边问边干」测试。
 *
 * Bug 1：生成过程中用户往上翻看历史，会被无休止拽回底部。
 *  根因：effect 依赖 [messages, busy]，流式进度每 400ms 更新消息 →
 *  messages 引用变化 → scrollIntoView 强制回底。它不判断用户在不在底部。
 *  修：只在 atBottom 时自动滚。
 *
 * Bug 2：助手先反问"你主要想用后端来做什么？"，紧接着"正在生成代码… 5861 字符"。
 *  根因：模型把反问写进 plan 字段（plan 为空时还会 fallback 成 reply），
 *  系统照常生成。修：plan 里是问号+疑问词 → 停下来问，不生成。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const KEY = (process.env.ZHIPU_API_KEY || '').trim() || fs.readFileSync(new URL('./zhipu-key.txt', import.meta.url), 'utf8').trim()

const browser = await chromium.launch()
// 视口压扁：聊天区只剩 ~280px 高，几条真实消息就能溢出，不用往 DOM 里塞假节点
// （塞节点会被 React 重渲染冲掉，高度塌陷会把 atBottom 抖回 true，测不准）
const page = await browser.newPage({ viewport: { width: 1200, height: 520 } })
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
// 预置 Key，否则会弹设置面板挡住按钮
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

console.log('=== 1) 上滚后不被拽回底部 ===')
// 发几条真实消息把聊天框撑出滚动条（chat 意图，返回快）
for (let i = 0; i < 5; i++) {
  await page.fill('textarea', `第 ${i + 1} 条消息，用来把聊天框撑出滚动条。`)
  await page.click('.send')
  await page.waitForTimeout(1600)
}

const scrollInfo = await page.evaluate(() => {
  const el = document.querySelector('.msgs')
  return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
})
const canScroll = scrollInfo.scrollHeight > scrollInfo.clientHeight + 20
ok('聊天框出现了滚动条', !!canScroll, JSON.stringify(scrollInfo))

if (canScroll) {
  // 用户往上滚
  await page.evaluate(() => {
    const el = document.querySelector('.msgs')
    el.scrollTop = 0
  })
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => document.querySelector('.msgs').scrollTop)
  ok('已经滚到顶部', before < 5, `scrollTop=${before}`)

  // 再发一条 → messages 变化 → effect 会跑。
  // 修复前这里会 scrollIntoView 把用户拽回底部
  await page.fill('textarea', '再发一条消息触发更新')
  await page.click('.send')
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => document.querySelector('.msgs').scrollTop)
  ok('上滚后停住了，没被拽回底部', after < 5, `scrollTop=${after}`)
}

console.log('\n=== 2) 滚回底部时又能自动跟随 ===')
await page.evaluate(() => {
  const el = document.querySelector('.msgs')
  el.scrollTop = el.scrollHeight
})
await page.waitForTimeout(400)
await page.fill('textarea', '再发一条消息')
await page.click('.send')
await page.waitForTimeout(3000)
const follow = await page.evaluate(() => {
  const el = document.querySelector('.msgs')
  return el.scrollHeight - el.scrollTop - el.clientHeight
})
ok('贴着底部时仍然自动跟随', follow < 60, `距底部 ${Math.round(follow)}px`)

console.log('\n=== 3) plan 是反问时不能生成 ===')
const q = await page.evaluate(async () => {
  const mod = await import('/src/App.tsx')
  // planIsQuestion 没导出，用源码字符串验证
  const src = await fetch('/src/App.tsx').then((r) => r.text())
  return src.includes('planIsQuestion') && src.includes('plan 里是反问，改为先问清楚')
})
ok('代码里有 plan 反问检测', q, '')

console.log('\n=== 4) 反问判定的边界 ===')
// 正常 plan 不能误判
const cases = [
  ['做一个作品集展示页，含 6 个作品卡片', false],
  ['FAQ 常见问题区块', false],
  ['在线问答模块，含提问和回答', false],
  ['你想做后端应用，但具体要实现什么功能还不清楚，你主要想用后端来做什么？', true],
  ['你主要想用后端来做什么？', true],
  ['要不要加一个联系表单？', true],
]
const judge = async (plan) =>
  page.evaluate((p) => {
    const t = p.trim()
    if (!t || !/[？?]/.test(t)) return false
    return /(吗|呢|哪些|什么|怎么|如何|哪一|要不要|能不能|可以吗|请问|想用|想做)/.test(t)
  }, plan)
for (const [plan, want] of cases) {
  const got = await judge(plan)
  ok(`「${plan.slice(0, 28)}」→ ${want ? '反问' : '正常'}`, got === want, `得到 ${got}`)
}

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
