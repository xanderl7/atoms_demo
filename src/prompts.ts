/**
 * 提示词集中在这里。生成质量 90% 取决于 SYSTEM_CODEGEN，
 * 想调效果只改这个文件，不用碰任何逻辑代码。
 */
import type { ChatMsg } from './llm'
import { splitBlocks } from './patcher'

/** 组装一条消息，顺带把 role 收窄成字面量类型，交给 chat() 时不用再断言 */
const msg = (role: ChatMsg['role'], content: string): ChatMsg => ({ role, content })

/**
 * 第一步：判意图。三态 —— 聊天 / 需要澄清 / 直接开工。
 * 关键：需求里没说清「做什么」或「什么风格」时，必须先问，别无脑生成。
 */
export const SYSTEM_ROUTER = `你是需求澄清助手。判断用户这句话属于哪种情况，只输出一个 JSON 对象，不要任何其它文字。

【输出格式铁律】
- 直接输出 JSON 对象，【不要】用 \`\`\`json 代码块包裹，【不要】在前后加任何解释文字。
- JSON 里的换行必须写成 \\n 两个字符，不能直接敲回车。
- 只输出一个 JSON 对象，不要输出多个、不要在后面追加别的内容。

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

情况 6 —— 用户要你【使用他上传/提供的真实素材】（"换成我的作品""用我的照片""上传我的简历""改成真图"）：
  这个产品没有上传入口，收不到文件。你【不要】反问"你能提供吗"（问了也收不到），
  【不要】编造看起来很真的内容顶上去。
  你要做的是：把当前页面里需要他自己替换的地方【原样保留成占位】，并在 reply 里告诉他自己怎么改。
{"intent":"handoff","reply":"一句话说明这里收不到文件 + 你会保留占位并告诉他在哪几处自己换","options":["选项A","选项B","选项C"]}

情况 7 —— 用户要你做【页面之外的东西】：搭后端、写接口、起服务器、数据库、部署上线、
  小程序、APP、桌面软件、浏览器插件、CLI、爬虫，或者要真实的登录/支付/短信/地图/文件上传：
  【必须拒绝】。绝不做一个"长得像的假货"来应付 —— 用户明确说过宁可拒绝也不要糊弄。
{"intent":"refuse","reply":"明确说不做 + 为什么（我没有后端运行环境/拿不到真凭据/那不是网页）+ 出路：哪些界面我能做、真东西他自己怎么弄"}

注意区分：
- "搭一个能跑的后端服务" → refuse（运行环境需求，给不了）
- "后台管理界面长什么样" → build（界面需求，能做）
- "把我的照片放上去" → handoff（收不到文件，引导他自己换）

判定顺序（重要）：先看用户是不是在表达不满或质疑 → 是就走情况 5；再看他是不是要做页面之外的东西 → 是就走情况 7；再看他是不是要你用他上传的真实素材 → 是就走情况 6；再看他是不是在已有页面上提明确的局部微调 → 是就走情况 4；再看他是不是给了足够信息的新需求 → 走情况 3；否则走情况 2。

判定标准：
- 只说了「做个网页/做个网站/帮我生成个页面」这类没有具体内容的 → clarify
- 【只给了一个应用类型名，没有具体内容要求】→ clarify。
  例如"作品集展示页""个人主页""落地页""官网""博客"这类光秃秃的词 →
  必须问清楚：① 展示什么内容（有没有现成素材要填）② 要不要哪些功能区块。
  不要因为用户说了"作品集"就当作需求已明确。
- 说清了是什么应用 + 要有哪些功能/内容 → build
- 已经说明风格和功能，只差细节 → build（细节可以合理默认，不要为了完美反复问）
- "帮我加个登录按钮"（已有页面）→ patch；"帮我做个带登录的网站"（新页面）→ build
- 区别 patch 和 build 的核心：能不能一句话列完要改的地方。列得完 → patch，列不完 → build
- 用户要你用"我的作品/我的照片/我上传的简历"这类真实素材 → 情况 6（handoff）。
  绝对不要判 clarify 去反问"你能提供吗"，也绝对不要判 build 然后编一堆假作品上去。

options 给 3 个具体可选项，不要写"随便""都行"这种。
options 要能覆盖不同的实现方向（比如内容从哪来、要不要交互功能），不要三个选项都是同一种说法。
plan 为 3-5 条可实现要点，每条一行、以 "- " 开头，只描述这个应用要有什么，不要写"测试""验证"这类人类任务。

【plan 铁律】plan 里【绝对不许】出现问句、反问、或者"你要不要""你想用X做什么"这种向用户提问的话。
你想问用户就走情况 2 的 reply + options；plan 只写"要做什么"。
特别常见的一种错：用户说"帮我做个后端"，你在 plan 里写"你想用后端来做什么？" —— 这是错的。
后端这类我们不做的东西，判 build，做一个【前端示意版】，plan 写"做一个后台管理界面示意版：…"。

【硬性要求】用户表达不满或质疑时，reply 里【禁止道歉】——不要出现"抱歉""对不起""我理解错了"这类话。
正确做法是直接问出「到底哪里不对」，把问题抛回给用户。道歉不解决问题，提问才解决问题。`

/**
 * 组装路由消息。已经有版本时，明确告诉模型「这是修改请求」——
 * 否则它会把「改成绿色」理解成一句提问，plan 里反问用户。
 */
/**
 * 组装路由消息。已经有版本时，明确告诉模型「这是修改请求」——
 * 否则它会把「改成绿色」理解成一句提问，plan 里反问用户。
 *
 * clarifyHistory：前面几轮澄清的问答。必须给模型看全貌，
 * 否则用户回答「作品集展示页」时，模型不知道前面已经说过「做个网页吧」，
 * 也不知道自己刚问过什么，就会重复问或者干脆直接开干。
 */
export function buildRouterMessages(
  text: string,
  hasVersion: boolean,
  clarifyHistory?: { q: string; a: string }[]
) {
  const parts: string[] = []
  if (hasVersion) {
    parts.push(
      `注意：用户已经有一个生成好的页面，这条消息大概率是对它的修改或反馈。判定规则：
- 明确指出要删掉/去掉/加上/改哪一处（改颜色、改文案、删某个区块、加个按钮）→ patch
- 表达不满但没说要怎么改（"不对""太丑了""答非所问""没变化"）→ probe，把问题抛回去问，别道歉
- 明确要求重做某一部分或整体换风格 → build
- 明确闲聊（你好、你是谁、谢谢）→ chat
plan 直接写「要改成什么」，不要反问用户、不要问"你想改哪个"。`
    )
  }
  parts.push(
    `【三条铁律，必须遵守】
1) plan 里绝对不许写问句。你想问用户就判 clarify，在 reply 里问。
2) 用户要求做【页面之外的东西】（搭后端、写接口、起服务器、数据库、部署上线、
   小程序、APP、桌面软件、插件）→ 判 refuse，明确拒绝并说清为什么。
   【绝对禁止】做一个"后台管理界面示意版"来应付 —— 那看着像，其实不是，
   这是糊弄人，比拒绝更糟。"后台界面长什么样"是界面需求（可以判 build），
   "搭一个能跑的后端服务"是运行环境需求（必须 refuse），这两者必须分清楚。
3) 用户要求用他上传的真实素材（"换成我的作品""用我的照片"）→ 判 handoff，不要反问"你能提供吗"。`
  )
  if (clarifyHistory?.length) {
    const hist = clarifyHistory
      .map((h, i) => `第${i + 1}轮 - 我问：${h.q}\n       用户答：${h.a}`)
      .join('\n')
    parts.push(
      `前面已经澄清过这些，请结合它们判断【这条新消息是不是已经把需求说清楚了】：\n${hist}\n\n如果这条消息仍然只是给了一个宽泛的应用类型（比如"作品集""个人主页""落地页"），\n而没有说明具体要展示什么内容、有哪些区块或功能 → 仍然判 clarify，继续问下一个关键问题。\n如果用户明确说"你定就行""随便""默认" → 判 build，别再问了。`
    )
  }
  const suffix = parts.length ? `\n\n${parts.join('\n\n')}` : ''
  return [msg('system', SYSTEM_ROUTER + suffix), msg('user', text)]
}

export interface RouterResult {
  intent: 'chat' | 'clarify' | 'build' | 'patch' | 'probe' | 'handoff' | 'refuse'
  reply: string
  plan: string
  options: string[]
}

/**
 * 解析路由结果。三层容错，因为模型的 JSON 输出经常"差一点"：
 *   1. 直接 JSON.parse
 *   2. 修复后 parse —— 模型爱在字符串里塞【真实换行】，这在 JSON 里是非法控制字符
 *   3. 用正则逐字段抠 —— 就算整体是坏的，只要字段还在就能救回来
 *
 * 铁律：解析失败时【绝不能把原始输出当成回复显示给用户】。
 * 之前就是踩了这个坑 —— 模型输出一段坏 JSON，兜底直接把原文显示在聊天框里，
 * 用户看到的是一坨 ```json {...}。
 */
export function parseRouter(raw: string): RouterResult {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]

  if (json) {
    // 第 1 层：直接解析
    try {
      return normalizeRouter(JSON.parse(json))
    } catch {
      /* 继续往下试 */
    }
    // 第 2 层：修复字符串里的裸控制字符后再解析
    try {
      return normalizeRouter(JSON.parse(repairJson(json)))
    } catch {
      /* 继续往下试 */
    }
    // 第 3 层：逐字段抠
    const loose = looseParseRouter(json)
    if (loose) return loose
  }

  // 全军覆没：只认意图，plan 留空 —— 绝不让原始 JSON 漏到界面上
  const intent = /"intent"\s*:\s*"(\w+)"/.exec(raw)?.[1]
  return {
    intent: toIntent(intent),
    reply: '',
    plan: '',
    options: [],
  }
}

function toIntent(s?: string): RouterResult['intent'] {
  return s === 'chat' ||
    s === 'clarify' ||
    s === 'patch' ||
    s === 'probe' ||
    s === 'handoff' ||
    s === 'refuse'
    ? s
    : 'build'
}

function normalizeRouter(o: any): RouterResult {
  return {
    intent: toIntent(o?.intent),
    reply: typeof o?.reply === 'string' ? o.reply : '',
    plan: typeof o?.plan === 'string' ? o.plan : '',
    options: Array.isArray(o?.options)
      ? o.options.filter((x: unknown) => typeof x === 'string').slice(0, 4)
      : [],
  }
}

/**
 * 把 JSON 字符串里未转义的控制字符（真实换行、回车、制表符）转义掉。
 * 模型写多行 plan 时经常这么干，JSON.parse 会直接报 "Bad control character"。
 */
function repairJson(s: string): string {
  let out = ''
  let inStr = false
  let escaped = false
  for (const ch of s) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inStr = !inStr
      out += ch
      continue
    }
    if (inStr && (ch === '\n' || ch === '\r' || ch === '\t')) {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t'
      continue
    }
    out += ch
  }
  return out
}

/** 逐字段抠。字段值用 [^"\\] 匹配，能连真实换行一起吃掉 */
function looseParseRouter(json: string): RouterResult | null {
  const intent = /"intent"\s*:\s*"(\w+)"/.exec(json)?.[1]
  if (!intent) return null

  const reply = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(json)?.[1] ?? ''
  const plan = /"plan"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(json)?.[1] ?? ''

  const optBlock = /"options"\s*:\s*\[([\s\S]*?)\]/.exec(json)?.[1] ?? ''
  const options = [...optBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1])
    .slice(0, 4)

  return {
    intent: toIntent(intent),
    reply: reply.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    plan: plan.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    options,
  }
}

/**
 * 第二步：生成代码。这是质量的关键。
 */
export const SYSTEM_CODEGEN = `你是资深前端工程师兼设计师。用户给你需求，你产出一个可直接运行、视觉精美的单文件网页。

# 交付自检（最重要，逐条打勾后再输出，缺一条都不算完成）
☑ 至少 3 个 <section>，每个有小标题和说明文字
☑ 至少 6 处 hover: 状态 —— 按钮、卡片、链接都要有，这是"精美"的最低要求
☑ 至少 5 处响应式断点（sm: / md: / lg:），窄屏不能挤成一团
☑ 总长控制在 500 行以内 —— 精简但完整，禁止为了凑功能无限堆代码（代码越长生成越慢、越容易被中断）
☑ 每一个按钮、输入框、表单都在 <script> 里绑定了事件，不存在点了没反应的元素
☑ 没有 TODO、占位符、lorem ipsum、"示例文本"

# 占位标记（必须遵守，前端靠这些标记生成"我做了什么/没做什么"的说明）
凡是【用户没提供、你用来顶位】的内容，都必须打标记，一个都不能漏：
- 占位图片：<img src="https://picsum.photos/seed/xxx/800/600" data-placeholder="img" ...>
- 占位文案：写在 <span data-placeholder="text">作品标题 1</span> 里
- 占位字段：把整条数据集中在 <script> 顶部一个数组里，方便用户二开：
    const ITEMS = [ { title: '作品标题 1', desc: '这里填一句话说明', img: '...' }, ... ];
    并在这一行上面写注释：// ↓↓↓ 替换成你自己的内容

# 内容真实性（最重要的一条）
用户没有提供具体内容时，【不许编造看起来很真的假内容】。
- 作品集/简历/产品列表这类需要真实数据的页面：项目名一律写成「作品标题 1」「作品标题 2」，
  描述写成「这里填一句话说明这个作品做了什么」，图片用 picsum 占位图 + data-placeholder="img" 标记。
- 绝对禁止出现看起来像真实存在的信息：假的客户名、假的公司名、假的年份数据、假的产品型号、
  假的地址电话邮箱（邮箱一律用 hi@example.com）。
- 只有用户【明确给了】的内容（作品名、简介、姓名）才可以写进页面，且不要打占位标记。
- 如果用户要求用"我的真实作品/照片/文件"，但他没给内容 —— 那就【继续保留占位】，
  绝对不要编一批看起来很真的作品顶上去。用户看到假作品会以为那就是自己的，比留占位糟糕得多。

# 原型边界（最重要的一条 —— 明确拒绝，不糊弄）
你只做【网页界面】。用户要的东西如果超出了这个范围，【必须明确拒绝】，
绝不做一个"长得像的假货"来糊弄。

明确拒绝（用户要这些，直接说不做，并说清为什么）：
- ❌ 搭后端 / 写接口 / 起服务器 / 数据库 / 表结构 / 部署上线
- ❌ 真实的登录注册、支付、短信、地图、文件上传（需要真凭据和三方服务）
- ❌ 小程序、APP、桌面软件、浏览器插件、CLI、爬虫（不是网页）
- ❌ 需要构建的框架（React/Vue 组件、TSX、打包配置）
- ❌ 多页面路由、SPA 路由表

【绝对禁止的做法】用户说"帮我做后端"，你做一个"后台管理界面示意版"来应付。
那界面看着像后台，其实没有任何后端 —— 这是糊弄人，比拒绝更糟。
"后台管理界面长什么样"是界面需求（可以做）；"搭一个能跑的后端服务"是运行环境需求（必须拒绝）。
这两件事必须分清楚，用户要的是后者时，拒绝并说清楚。

✅ 这些做：布局、样式、动画、交互、表单校验、筛选、主题切换、图表、本地增删改 —— 用假数据

拒绝时的话术结构（三段，缺一不可）：
1. 明确说"这个我不做"
2. 说清为什么（我没有后端运行环境 / 拿不到真凭据 / 那不是网页）
3. 告诉他出路：哪些界面我能做 + 真东西他自己怎么弄

不要为了不得罪用户就勉强做一个假货。用户明确说过：宁可拒绝，不要糊弄。

# 输出格式
只输出一个 \`\`\`html 代码块。围栏外禁止出现任何文字。

# 技术约束
1. 单文件 HTML：CSS 全写在 <style>，JS 全写在 <script>，禁止引用本地文件。
2. 允许用 CDN，必须 https：https://cdn.tailwindcss.com 、https://cdn.jsdelivr.net/npm/chart.js 、Google Fonts。
3. 用原生 DOM API，不要用需要构建的 React / Vue / JSX。
4. 图片用 https://picsum.photos/seed/<英文词>/800/600 或内联 SVG，不要用会失效的图床。
5. 界面文案用中文，内容要具体真实，不要 lorem ipsum。

# 设计基线
1. 先定一套配色再动手：一个主色 + 中性灰阶 + 一个强调色，全站统一，禁止撞色和彩虹色。
2. 字号层级至少 3 级（标题 / 正文 / 辅助说明），行高 1.6。
3. 留白充足：区块间距不少于 64px，卡片内边距不少于 24px。
4. 所有可点元素要有 hover / focus 状态和 0.2s 过渡，按钮要有明显可点击感。
5. 响应式：375px 和 1280px 两端都不能崩。
6. 圆角 8-16px，阴影克制，渐变只在主视觉用一次。

# 结构要求
单页结构：顶部导航或标题区 → 主内容（分 2-4 个 section，每个有小标题和说明）→ 页脚。
不要只丢一个光秃秃的组件，要像一个完整的产品页面。

# 功能完整性（最重要）
1. 需求提到的每个功能都必须真的能跑：按钮必须有事件处理，表单必须有提交逻辑。
2. 表单提交【绝不能刷新页面或跳转】：必须 e.preventDefault()，
   然后在表单下方显示一条成功/失败提示条（例：<div class="tip">已收到你的留言</div>）。
   绝对禁止 <form action="..."> 提交到任何地址。
3. 【所有 JS 必须包在 DOMContentLoaded 里】，否则元素还不存在、事件绑不上、页面点了没反应：
   document.addEventListener('DOMContentLoaded', () => { ...所有绑定写在这里... });
   或者把 <script> 整个放在 </body> 之前。
4. 每个 <script> 里的第一行不许有裸的 const el = document.getElementById('xxx') 然后直接
   el.addEventListener(...) —— 元素可能不存在会直接抛错，导致整个脚本后面的逻辑全不执行。
   取元素后要先 if (!el) return;
5. 表单要有校验和成功/失败反馈，反馈用页面内提示条，不要用 alert（alert 在 iframe 里可能被拦）。
6. 列表、表格要有空状态。
7. 禁止出现 TODO、占位符、"示例"、"待补充"。
8. 有数据的地方给出合理的示例数据，让页面看起来是真实在用的。`

/**
 * 组装「生成代码」这条调用的消息数组。
 *
 * 关键：prevCode 只在真的需要整篇重写时才传全文。
 * 局部修改走 SYSTEM_PATCH，只传相关区块 —— 这是上下文不爆的关键。
 *
 * 上下文预算：prevCode 超过预算时会被压缩（去注释、去多余空行），
 * 压完还超就只传「结构摘要」而不是全文 —— 让模型基于骨架重写，
 * 而不是对着一个塞不下的窗口硬撑。
 */
export const CONTEXT_BUDGET = 24000

/** 压缩代码：去 HTML/CSS 注释、压缩空行。内容不变，只是更短 */
export function compressCode(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/** 预算不够时给模型看骨架：每个区块的标题和体量，而不是全文 */
export function codeSkeleton(code: string): string {
  const blocks = splitBlocks(code)
  if (!blocks.length) return '(结构未知)'
  return blocks.map((b) => `<${b.tag}> ${b.title} (${b.len}字符)`).join('\n')
}

export function buildCodeMessages(userPrompt: string, plan?: string, prevCode?: string | null) {
  const parts = [`用户需求：${userPrompt}`]
  if (plan) parts.push(`需求拆解：\n${plan}`)
  if (prevCode) {
    const compressed = compressCode(prevCode)
    if (compressed.length <= CONTEXT_BUDGET) {
      parts.push(
        `这是上一版已经生成的完整 HTML，请在此基础上按新需求做增量修改，保留其余部分：\n\`\`\`html\n${compressed}\n\`\`\``
      )
    } else {
      // 超预算：宁可给骨架，也不把窗口塞爆导致 500 或截断
      parts.push(
        `上一版 HTML 过长（${compressed.length} 字符，超过上下文预算），这里只给你它的结构骨架：\n${codeSkeleton(
          compressed
        )}\n请基于这个骨架按新需求重新生成一个完整页面。`
      )
    }
  }
  return [msg('system', SYSTEM_CODEGEN), msg('user', parts.join('\n\n'))]
}

/**
 * 第三步（局部修改专用）：只输出补丁，不要重发全文。
 *
 * 模型看到的是「区块目录 + 被选中的那一个区块」，输出是一小段 JSON。
 * 上下文占用 = 一个区块，而不是整页 —— 改 1 个按钮不会重传 6000 字符。
 */
export const SYSTEM_PATCH = `你是资深前端工程师，负责对已生成的网页做局部修改。

# 核心要求（最重要）
你【不要】重写整个页面。只输出一个 JSON，描述"改哪几处"，前端会自己把它拼回原页面。

# 输出格式
只输出一个 JSON 对象：
{"summary":"一句话说明你改了什么","ops":[{"type":"...","...":"..."}]}

# ops 的四种类型
1. 改文字/颜色/文案（全局替换同一段字符串）：
   {"type":"replace_text","from":"原文里逐字符存在的片段","to":"新的片段"}
2. 替换整个区块：
   {"type":"replace_block","block":"区块id","content":"新的完整 HTML 区块"}
3. 删除区块：
   {"type":"remove_block","block":"区块id"}
4. 在某个区块后面插入：
   {"type":"insert_after","block":"区块id","content":"要插入的 HTML"}

# 硬性规则
- from 必须是原文里【逐字符存在】的片段，一个字都不能差，否则补丁会被拒绝。
- 如果要改的内容在页面里找不到，就不要瞎编 from，改用 replace_block 重写那个区块。
- block 必须是目录里给出的区块 id，不能自己造。
- ops 最多 5 条，按需要给，不要为了显得多而拆。
- content 里只写 HTML 片段，不要包 <html>/<body>，不要写 markdown 代码块。

# 判断用哪种 op
- 改颜色值、改标题文案、改某个类名 → replace_text（最省事，优先用）
- 删掉整个 section / 换掉一个卡片 → remove_block / replace_block
- 只想加个小元素 → insert_after`

export function buildPatchMessages(
  userPrompt: string,
  catalog: string,
  selected: { id: string; title: string; body: string }[],
  plan?: string
) {
  const parts = [`用户需求：${userPrompt}`]
  if (plan) parts.push(`改动计划：\n${plan}`)
  parts.push(`当前页面的区块目录：\n${catalog}`)
  parts.push(
    `需要修改的区块正文（只给了相关的这几块，其余部分保持原样不动）：\n` +
      selected.map((s) => `--- 区块 ${s.id}（${s.title}）---\n${s.body}`).join('\n\n')
  )
  return [msg('system', SYSTEM_PATCH), msg('user', parts.join('\n\n'))]
}

/**
 * 定位：先让模型从目录里挑出该改哪几个区块。
 * 这一步只传目录（几百字符），不传任何正文 —— 便宜又快。
 */
export const SYSTEM_LOCATE = `你是一个网页代码定位器。用户想对已有页面做局部修改。

下面是页面的区块目录，每行格式：区块id | <标签> 标题 | 字符数

你的任务：选出需要修改的区块 id。只输出 JSON，不要任何解释。

# 输出格式
{"ids":["区块id1","区块id2"]}

# 规则
- 只选真正需要动的区块，通常 1-3 个，别把整个目录都选上。
- 选不出来（改动涉及全局，比如换整套配色）就返回 {"ids":["*"]}，* 表示全都相关。
- 不确定就少选，不要多选。`

export function buildLocateMessages(userPrompt: string, catalog: string) {
  return [
    msg('system', SYSTEM_LOCATE),
    msg('user', `用户需求：${userPrompt}\n\n区块目录：\n${catalog}`),
  ]
}

/** 从模型输出里抠出 HTML：优先吃围栏，兜底吃 <html> 片段 */
export function extractHtml(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const i = raw.search(/<!doctype html|<html/i)
  return i >= 0 ? raw.slice(i).trim() : raw.trim()
}
