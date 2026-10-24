/**
 * 验证「改动量级分流」：路由能不能把 小改动/大改动/质疑 分对。
 * 不测 UI，纯测提示词 + 解析 + 本地快改规则。
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

// 页面里跑真实的路由判定（用页面的 /zhipu 代理，绕开 CORS）
const route = async (text, hasVersion) =>
  page.evaluate(
    async ([t, hv]) => {
      const r = await fetch('/zhipu/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('atoms-demo.llm-config') ? JSON.parse(localStorage.getItem('atoms-demo.llm-config')).apiKey : ''}` },
        body: JSON.stringify({
          model: 'glm-4.5-air',
          temperature: 0.2,
          thinking: { type: 'disabled' },
          messages: [
            {
              role: 'system',
              content: `你是需求澄清助手。判断用户这句话属于哪种情况，只输出一个 JSON 对象，不要任何其它文字。

情况 1 —— 聊天（问候、闲聊、问你是谁、问你能做什么）：
{"intent":"chat","reply":"简短友好的中文回复"}

情况 2 —— 想做应用，但需求太模糊，必须先确认才能动手：
{"intent":"clarify","reply":"一句话说明你理解到的方向 + 你要问的那个最关键的问题","options":["选项A","选项B","选项C"]}

情况 3 —— 想做应用，且需求已经足够明确，可以直接做：
{"intent":"build","plan":"- 要点1\\n- 要点2\\n- 要点3"}

情况 4 —— 对已有页面做【局部微调】。判据是：改动只涉及 1-3 个具体位置，且都是明确的、可枚举的：
  改颜色 / 改字号 / 改圆角 / 改某段文案 / 删掉某个区块 / 去掉某个元素 / 加一个按钮 / 换个图 / 改个间距 / 换标题
{"intent":"patch","plan":"- 要点1\\n- 要点2"}

情况 5 —— 用户在【质疑】上一版结果，或表达不满（"不对""不是我要的""太丑了""答非所问""没变化""你没懂我的意思"）：
{"intent":"probe","reply":"一句话说明你理解的偏差 + 你要问的那个最关键的问题","options":["选项A","选项B","选项C"]}

判定顺序（重要）：先看用户是不是在表达不满或质疑 → 是就走情况 5；再看他是不是在已有页面上提明确的局部微调 → 是就走情况 4；再看他是不是给了足够信息的新需求 → 走情况 3；否则走情况 2。

判定标准：
- 只说了「做个网页/做个网站/帮我生成个页面」这类没有具体内容的 → clarify
- 说清了是什么应用、或有哪些功能 → build
- 已经说明风格和功能，只差细节 → build（细节可以合理默认，不要为了完美反复问）
- "帮我加个登录按钮"（已有页面）→ patch；"帮我做个带登录的网站"（新页面）→ build
- 区别 patch 和 build 的核心：能不能一句话列完要改的地方。列得完 → patch，列不完 → build

options 给 3 个具体可选项，不要写"随便""都行"这种。
plan 为 3-5 条可实现要点，每条一行、以 "- " 开头，只描述这个应用要有什么，不要写"测试""验证"这类人类任务。

【硬性要求】用户表达不满或质疑时，reply 里【禁止道歉】——不要出现"抱歉""对不起""我理解错了"这类话。
正确做法是直接问出「到底哪里不对」，把问题抛回给用户。道歉不解决问题，提问才解决问题。${
          hv
            ? `\n\n注意：用户已经有一个生成好的页面，这条消息大概率是对它的修改或反馈。判定规则：
- 明确指出要删掉/去掉/加上/改哪一处（改颜色、改文案、删某个区块、加个按钮）→ patch
- 表达不满但没说要怎么改（"不对""太丑了""答非所问""没变化"）→ probe，把问题抛回去问，别道歉
- 明确要求重做某一部分或整体换风格 → build
- 明确闲聊（你好、你是谁、谢谢）→ chat
plan 直接写「要改成什么」，不要反问用户、不要问"你想改哪个"。`
            : ''
        }`,
            },
            { role: 'user', content: t },
          ],
        }),
      })
      const j = await r.json()
      const raw = j.choices?.[0]?.message?.content ?? ''
      const json = raw.match(/\{[\s\S]*\}/)?.[0]
      return json ? JSON.parse(json) : { intent: 'PARSE_FAIL', raw }
    },
    [text, hasVersion]
  )

console.log('=== 已有页面时的分流判定 ===')
const cases = [
  ['把主色调改成蓝色', 'patch'],
  ['标题改成「极简工作室」', 'patch'],
  ['删掉价格表那一块', 'patch'],
  ['把导航栏的按钮圆角改成 20px', 'patch'],
  ['加一个联系表单在页脚', 'patch'],
  ['不对，太丑了', 'probe'],
  ['你为什么答非所问呢', 'probe'],
  ['没变化，跟我说的完全不一样', 'probe'],
  ['整个页面重新设计成暗色极简风，加动画，改成三栏布局', 'build'],
  ['把首页换成完整的电商首页，带购物车和结算流程', 'build'],
  ['你好', 'chat'],
]

for (const [text, want] of cases) {
  const r = await route(text, true)
  check(`「${text}」 → ${want}`, r.intent === want, `实得 ${r.intent}`)
}

// 质疑时必须反问，不能道歉
console.log('\n=== 质疑时不能道歉 ===')
const probeCases = ['不对，太丑了', '你为什么答非所问呢', '没变化，跟我说的完全不一样']
for (const text of probeCases) {
  const r = await route(text, true)
  const reply = String(r.reply || '')
  const apologized = /抱歉|对不起|不好意思|我理解错|是我错了/.test(reply)
  check(`「${text}」 不道歉`, !apologized, reply.slice(0, 50))
  check(`「${text}」 有 options`, Array.isArray(r.options) && r.options.length >= 2, JSON.stringify(r.options))
}

// 首次生成的模糊需求仍然要 clarify
console.log('\n=== 首次生成 ===')
const r1 = await route('帮我做个网站', false)
check('「帮我做个网站」 → clarify', r1.intent === 'clarify', `实得 ${r1.intent}`)
const r2 = await route('做一个个人简历网页，包含照片、基本信息、工作经历和技能标签', false)
check('「做一个个人简历网页…」 → build', r2.intent === 'build', `实得 ${r2.intent}`)

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} 通过 =====`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
