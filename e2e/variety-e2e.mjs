/**
 * 花样生成专项测试（浏览器真实驱动）。
 *
 * 目标：让应用生成各种不同类型的页面，每类都过同一套检查，
 * 抓「模型抽风」类问题——内容空、有运行时错误、JSON 泄漏、
 * 自检没跑、交互点了没反应。
 *
 * 每个场景的检查项：
 *   1. 生成完成（停止按钮变回发送）
 *   2. 自检结论出现（✅通过 / 🔧已修复 / ⚠️修不完告知）
 *   3. 预览区有实质内容（文本够长 / 交互够多 / 能用的极简工具，三选一）
 *   4. 没有"未知错误"假报错
 *   5. 聊天区没有 JSON 泄漏（```json / "intent": 漏出）
 *   6. 页面无 TODO / lorem 占位
 *   7. 点页面里第一个可点元素，不产生新的运行时错误（交互 smoke）
 *
 * 跑法：ZHIPU_API_KEY=xxx node e2e/variety-e2e.mjs（需先 npm run dev）
 * 每个场景生成 + 自检约 40-70s，10 个场景约 8-12 分钟。
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL || 'http://localhost:5173'
const STORE = 'atoms-demo.llm-config'
if (!process.env.ZHIPU_API_KEY) {
  console.error('缺少 ZHIPU_API_KEY 环境变量')
  process.exit(2)
}

/** 10 种花样：覆盖不同类型/风格/交互的页面 */
const SCENARIOS = [
  { name: '企业落地页', prompt: '做一个 SaaS 企业落地页：顶部导航、Hero 区（大标题+副标题+两个按钮）、三个特性卡片、客户 logo 墙、页脚' },
  { name: '个人作品集', prompt: '做一个摄影师个人作品集页面：顶部姓名和导航、作品网格（6 张图）、关于我、联系表单，图片用 picsum 占位' },
  { name: '数据仪表盘', prompt: '做一个销售数据仪表盘：顶部四个统计卡片（本月销售额/订单数/新增用户/转化率）、一个柱状图、一个最近订单表格' },
  { name: '博客文章页', prompt: '做一个博客文章阅读页：文章标题、作者信息、正文（几段文字+小标题）、左侧目录、底部相关文章' },
  { name: '活动报名页', prompt: '做一个技术大会报名页：大会信息（时间地点）、议程表、报名表单（姓名/邮箱/票种，带校验和提交反馈）' },
  { name: '电商商品列表', prompt: '做一个潮汕特产的电商商品列表页：顶部搜索框、左侧分类筛选、商品卡片网格（价格+加入购物车按钮）、购物车数量角标' },
  { name: '暗色主题页', prompt: '做一个暗色主题的游戏工作室官网：Hero 区、游戏展示区、团队介绍、招聘板块，整体深色背景配霓虹强调色' },
  { name: '移动端 H5', prompt: '做一个移动端 H5 奶茶店点单页：竖屏布局、商品分类 tab、商品列表、底部购物车栏，宽度按手机设计' },
  { name: 'FAQ 帮助中心', prompt: '做一个帮助中心 FAQ 页面：左侧分类导航、右侧问答列表（手风琴展开收起）、顶部搜索框' },
  { name: '番茄钟工具', prompt: '做一个番茄钟专注工具：大号倒计时显示、开始/暂停/重置按钮、工作/休息模式切换、完成次数统计' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

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

const results = []
const check = (scenario, name, ok, detail = '') => {
  results.push({ scenario, name, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

for (const [idx, sc] of SCENARIOS.entries()) {
  console.log(`\n${'━'.repeat(60)}\n[${idx + 1}/${SCENARIOS.length}] ${sc.name}\n${'━'.repeat(60)}`)
  const errCountBefore = pageErrors.length
  // 断言作用域：只查本轮新增的助手消息。整个会话有 10 个场景，
  // 查 .msgs 全文会把上一个场景的结论/泄漏算到本轮头上（假通过/连带失败）
  const bubblesBefore = await page.locator('.bubble.assistant').count()

  await page.fill('.composer textarea', sc.prompt)
  await page.click('button.send')

  // 1) 等生成结束（可能先澄清一轮：出现选项就点第一个"直接做"类的，
  //    我们的选项兜底叫「就按你默认的来」；没有选项就一直等生成完）
  let clarified = false
  try {
    await page.waitForSelector('.options .opt', { timeout: 25000 })
    clarified = true
    console.log('  （走了澄清轮，点兜底选项放行）')
    await page.click('.options .opt >> nth=-1') // 最后一项固定是「就按你默认的来」
  } catch {
    /* 没澄清，直接生成 */
  }

  try {
    await page.waitForSelector('button.send:not(.stop)', { timeout: 240000 })
  } catch {
    check(sc.name, '生成完成', false, '240s 超时仍未结束')
    continue
  }

  // 2) 等自检结论（只看最后一条助手消息，且必须是本轮新出的）
  let selfCheck = '未出现'
  try {
    await page.waitForFunction(
      (n) => {
        const bs = document.querySelectorAll('.bubble.assistant')
        const last = bs[bs.length - 1]
        return (
          bs.length > n && !!last && /自检通过|已自动修复|仍有 \d+ 个问题/.test(last.innerText)
        )
      },
      bubblesBefore,
      { timeout: 90000 }
    )
    selfCheck = '已出现'
  } catch {
    /* 下面统一判 */
  }
  const newChat = await page.evaluate(
    (n) =>
      [...document.querySelectorAll('.bubble.assistant')]
        .slice(n)
        .map((b) => b.innerText)
        .join('\n'),
    bubblesBefore
  )
  // 结论原文（✅通过 / 🔧修复了 N 个 / ⚠️修不完）—— 写进 detail，
  // 批量跑完能直接看出哪些场景触发了自动修复、有没有误报。
  // 取最后一条匹配：修复后还会追加复检结论，最后一条才是最终状态
  const conclMatches = [
    ...newChat.matchAll(/(✅ 自检通过[^\n]*|🔧 已自动修复[^\n]*|仍有 \d+ 个问题[^\n]*)/g),
  ]
  const conclusion = conclMatches.length ? conclMatches[conclMatches.length - 1][0] : selfCheck
  check(sc.name, '生成完成', true, clarified ? '（经一轮澄清）' : '')
  check(sc.name, '自检结论出现', selfCheck === '已出现', conclusion.slice(0, 80))

  // 3) iframe 有实质内容。
  //    文本长度不是唯一判据：工具类页面（番茄钟/计算器）天然字少，
  //    实测瘦身版 108-145 字符但结构完整（倒计时 + 3-6 个按钮）。
  //    判据三选一：「文本够长」（内容型页面）/「交互够多」（功能型页面）
  //    /「能用的极简工具」（>=3 个可交互元素且有基本文本）。
  //    真正坏死的页面（空 body / 解析崩）三条都不满足；
  //    另有 TODO 检查、交互 smoke（点了不报错）兜底。
  let frameText = ''
  let frameInteractive = 0
  try {
    frameText = await page.frameLocator('.stage iframe').locator('body').innerText({ timeout: 5000 })
    frameInteractive = await page
      .frameLocator('.stage iframe')
      .locator('button, a, input, select, [role="button"]')
      .count()
  } catch {
    /* iframe 还没就绪 */
  }
  const textLen = frameText.trim().length
  check(
    sc.name,
    '预览区有实质内容',
    textLen > 120 || (frameInteractive >= 5 && textLen > 50) || (frameInteractive >= 3 && textLen > 50),
    `${textLen} 字符 / ${frameInteractive} 个可交互元素`
  )

  // 4) 无"未知错误"假报错
  const errBar = await page.evaluate(() => document.querySelector('.frame-errors')?.innerText ?? '')
  check(sc.name, '没有假报错（未知错误）', !errBar.includes('未知错误'), errBar.slice(0, 60) || '无报错条')

  // 5) 无 JSON 泄漏（同样只查本轮新增的助手消息）
  check(
    sc.name,
    '聊天区无 JSON 泄漏',
    !/```json|"intent"\s*:|"plan"\s*:/.test(newChat),
    newChat.match(/"intent"\s*:\s*"\w+"/)?.[0] ?? ''
  )

  // 6) 页面无 TODO/lorem 占位
  check(sc.name, '页面无 TODO/lorem 占位', !/TODO|lorem ipsum/i.test(frameText))

  // 7) 交互 smoke：点页面里第一个可点元素，不应产生新的 pageerror
  try {
    const btn = page.frameLocator('.stage iframe').locator('button, a, [role="button"]').first()
    if (await btn.count()) {
      await btn.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(800)
    }
  } catch {
    /* 点不到就算了，不算失败 */
  }
  const newErrors = pageErrors.slice(errCountBefore)
  check(sc.name, '点击交互无运行时错误', newErrors.length === 0, newErrors[0] ?? '')
}

await browser.close()

console.log(`\n${'═'.repeat(60)}\n汇总\n${'═'.repeat(60)}`)
const byScenario = new Map()
for (const r of results) {
  if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, [])
  byScenario.get(r.scenario).push(r)
}
for (const [sc, rs] of byScenario) {
  const failed = rs.filter((r) => !r.ok)
  console.log(`${failed.length ? '❌' : '✅'} ${sc}${failed.length ? ` — ${failed.map((f) => f.name).join('、')}` : ''}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 项检查通过`)
process.exit(failed ? 1 : 0)
