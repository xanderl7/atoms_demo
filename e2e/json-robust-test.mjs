/**
 * 验证「坏 JSON 不漏到界面上」。
 * 复现用户截图的场景：模型输出 ```json {...} 且 plan 里有真实换行。
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })

const parse = async (raw) =>
  page.evaluate(async (r) => {
    const mod = await import('/src/prompts.ts')
    return mod.parseRouter(r)
  }, raw)

console.log('=== 复现用户截图的坏 JSON ===')
// 模型用 ```json 包裹 + plan 字段里是真实换行
const badJson = '```json\n{\n  "intent": "build",\n  "plan": "- 顶部 Hero 区：个人简介（姓名、\n职位、一句话介绍）及头像\\n- 项目展示区/作品集：瀑布流或网格布局，分类展示 UI、视觉、插画三类作品，支持分类筛选\\n- 联系方式区：邮箱、社交链接（Dribbble/Behance/站酷等）及联系表单\\n- 整体视觉风格：极简现代，留白充足，突出作品视觉效果"\n}\n```'

const r1 = await parse(badJson)
console.log('解析结果：', JSON.stringify(r1, null, 2))
check('坏 JSON 仍能解析出 intent', r1.intent === 'build', r1.intent)
check('坏 JSON 仍能解析出 plan', r1.plan.length > 20, `${r1.plan.length} 字符`)
check('plan 里没有裸 JSON 符号', !/^[\s]*[{[]/.test(r1.plan))
check('plan 不是 ```json 开头', !r1.plan.includes('```json'))
check('plan 不含 "intent": 字样', !r1.plan.includes('"intent"'))

console.log('\n=== 其它几种坏法 ===')
const cases = [
  ['标准 JSON', '{"intent":"build","plan":"- a\\n- b"}', 'build'],
  ['带 markdown 围栏', '```json\n{"intent":"clarify","reply":"你想做什么？","options":["A","B"]}\n```', 'clarify'],
  ['前面有废话', '好的，我来判断：\n{"intent":"patch","plan":"- 改颜色"}', 'patch'],
  ['plan 里有真实换行', '{"intent":"build","plan":"- 第一行\n- 第二行\n- 第三行"}', 'build'],
  ['单引号坏JSON', "{'intent':'build','plan':'- x'}", 'build'],
  ['截断的 JSON', '{"intent":"build","plan":"- 第一行\n- 第二行', 'build'],
  ['完全不是 JSON', '我觉得用户想要一个作品集页面', 'build'],
  ['空字符串', '', 'build'],
]

for (const [name, raw, want] of cases) {
  const r = await parse(raw)
  const okIntent = r.intent === want
  const noLeak = !/```|"intent"\s*:|^\s*[{[]/.test(r.plan + r.reply)
  check(`${name} → intent=${want}`, okIntent, `实得 ${r.intent}`)
  check(`${name} 无原始 JSON 泄漏`, noLeak, (r.plan + r.reply).slice(0, 50))
}

console.log('\n=== 澄清分支要能拿到 reply 和 options ===')
const clarify = await parse(
  '```json\n{"intent":"clarify","reply":"你想做什么类型的网页？","options":["企业官网","作品集","个人博客"]}\n```'
)
check('拿到 reply', clarify.reply.includes('什么类型'), clarify.reply)
check('拿到 3 个 options', clarify.options.length === 3, JSON.stringify(clarify.options))

const probe = await parse('{"intent":"probe","reply":"哪部分不对？","options":["样式","内容"]}')
check('probe 拿到 reply', probe.reply.includes('不对'), probe.reply)
check('probe 拿到 options', probe.options.length === 2, JSON.stringify(probe.options))

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
