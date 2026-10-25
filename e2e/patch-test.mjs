/**
 * 验证 patch 路径：
 *  1. 本地规则快改（改颜色/删区块/改标题）—— 0 次 LLM 调用
 *  2. 定位 + 补丁 —— 上下文用量远小于整篇重写
 *  3. 补丁应用后页面没坏
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

// 在页面里直接调 patcher 的纯函数（通过动态 import 源码）
const callApi = async (path, body) =>
  page.evaluate(
    async ([p, b]) => {
      const cfg = JSON.parse(localStorage.getItem('atoms-demo.llm-config'))
      const r = await fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(b),
      })
      return await r.json()
    },
    [path, body]
  )

// ============ Part 1: 本地规则快改 ============
console.log('=== Part 1: 本地规则快改（零 LLM 调用）===')

const SAMPLE = `<!doctype html><html><head><style>
:root { --primary: #2563eb; --bg: #ffffff; }
.btn { color: #2563eb; border-radius: 8px; }
</style></head><body>
<header><h1>极简工作室</h1></header>
<section><h2>我们的服务</h2><p>设计与开发</p></section>
<section><h2>价格表</h2><p>基础版 99 元</p></section>
<footer><p>© 2026</p></footer>
</body></html>`

const localResults = await page.evaluate(async (code) => {
  // 用页面已加载的模块：动态 import 源码文件
  const mod = await import('/src/patcher.ts')
  return {
    color: mod.tryLocalPatch('把主色调改成红色', code),
    deleteBlock: mod.tryLocalPatch('删掉价格表', code),
    title: mod.tryLocalPatch('标题改成「云端设计」', code),
    unknown: mod.tryLocalPatch('帮我加个登录功能', code),
    blocks: mod.splitBlocks(code).map((b) => ({ id: b.id, tag: b.tag, title: b.title })),
  }
}, SAMPLE)

check('改主色命中', !!localResults.color, localResults.color?.note)
check(
  '改主色后红色确实出现',
  !!localResults.color && localResults.color.html.includes('#dc2626') && !localResults.color.html.includes('#2563eb')
)
check('删区块命中', !!localResults.deleteBlock, localResults.deleteBlock?.note)
check(
  '删区块后「价格表」消失',
  !!localResults.deleteBlock && !localResults.deleteBlock.html.includes('价格表')
)
check('改标题命中', !!localResults.title, localResults.title?.note)
check(
  '改标题后新标题出现',
  !!localResults.title && localResults.title.html.includes('云端设计')
)
check('判不准时返回 null（交给 LLM）', localResults.unknown === null, String(localResults.unknown))
check('区块切分正确', localResults.blocks.length === 5, `${localResults.blocks.length} 个区块（style/header/2×section/footer）`)
check(
  '区块标题识别正确',
  localResults.blocks.some((b) => b.title.includes('价格表')),
  JSON.stringify(localResults.blocks.map((b) => b.title))
)

// ============ Part 2: 定位 + 补丁 ============
console.log('\n=== Part 2: 定位 + 补丁（上下文远小于全文）===')

const CODE = `<!doctype html><html><head><style>
:root { --primary: #2563eb; }
.btn { background: #2563eb; }
</style></head><body>
<header><h1>极简工作室</h1></header>
<section><h2>我们的服务</h2><p>设计与开发</p></section>
<section><h2>价格表</h2><p>基础版 99 元</p></section>
<footer><p>© 2026</p></footer>
</body></html>`

const locRaw = await callApi('/zhipu/chat/completions', {
  model: 'glm-4.5-air',
  temperature: 0.2,
  thinking: { type: 'disabled' },
  messages: [
    {
      role: 'system',
      content: `你是一个网页代码定位器。用户想对已有页面做局部修改。

下面是页面的区块目录，每行格式：区块id | <标签> 标题 | 字符数

你的任务：选出需要修改的区块 id。只输出 JSON，不要任何解释。

# 输出格式
{"ids":["区块id1","区块id2"]}

# 规则
- 只选真正需要动的区块，通常 1-3 个，别把整个目录都选上。
- 选不出来（改动涉及全局，比如换整套配色）就返回 {"ids":["*"]}，* 表示全都相关。
- 不确定就少选，不要多选。`,
    },
    {
      role: 'user',
      content: `用户需求：把价格表区块删掉\n\n区块目录：\nb_xxx | <header> 极简工作室 | 120字符\nb_yyy | <section> 我们的服务 | 150字符\nb_zzz | <section> 价格表 | 140字符\nb_www | <footer> © 2026 | 100字符`,
    },
  ],
})
const locText = locRaw.choices?.[0]?.message?.content ?? ''
check('定位返回 JSON', locText.includes('{'), locText.slice(0, 80))

// 实打实跑一次真实流程：生成 → 说"改颜色" → 看是否走 patch
console.log('\n=== Part 3: 端到端 —— 改颜色应该走 patch 不重写 ===')

await page.locator('.composer textarea').fill('做一个简单的落地页，包含标题、功能介绍和联系按钮')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
  timeout: 180000,
})
await page.waitForTimeout(800)

const readCode = async () => {
  await page.locator('.segmented button', { hasText: '代码' }).click()
  await page.waitForTimeout(300)
  const txt = await page.locator('pre.code').innerText()
  await page.locator('.segmented button', { hasText: '预览' }).click()
  await page.waitForTimeout(200)
  return txt.replace(/^\s*\d+\s/gm, '')
}

const v1 = await readCode()
check('v1 生成成功', v1.length > 1000, `${v1.length} 字符`)

// 改颜色 —— 走 patch
await page.locator('.composer textarea').fill('把主色调改成深蓝色')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
  timeout: 180000,
})
await page.waitForTimeout(800)

const v2 = await readCode()
const lastMsg = await page.locator('.bubble.assistant').last().innerText()
check('改颜色后代码有变化', v1 !== v2, `${v1.length} → ${v2.length}`)
check('页面没坏（html 结构完整）', v2.includes('</html>') && v2.includes('<style'))
check('没有降级到整篇重写', !lastMsg.includes('整页重写'), lastMsg.slice(0, 80))

// 删区块 —— 走 patch
await page.locator('.composer textarea').fill('删掉联系按钮那一部分')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
  timeout: 180000,
})
await page.waitForTimeout(800)
const v3 = await readCode()
check('删区块后代码有变化', v2 !== v3, `${v2.length} → ${v3.length}`)
check('v3 结构仍完整', v3.includes('</html>'))

// 质疑 —— 应该反问，不道歉
await page.locator('.composer textarea').fill('不对，太丑了')
await page.locator('.send').click()
await page.waitForSelector('.step.running', null, { timeout: 15000 }).catch(() => {})
await page.waitForFunction(() => document.querySelectorAll('.step.running').length === 0, null, {
  timeout: 120000,
})
await page.waitForTimeout(800)

const probeMsg = await page.locator('.bubble.assistant').last().innerText()
const optCount = await page.locator('.options .opt').count()
check('质疑时反问而非道歉', !/抱歉|对不起|不好意思/.test(probeMsg), probeMsg.slice(0, 70))
check('质疑时给选项', optCount >= 2, `${optCount} 个选项`)

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
