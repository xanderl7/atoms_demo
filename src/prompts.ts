/**
 * 提示词集中在这里。生成质量 90% 取决于 SYSTEM_CODEGEN，
 * 想调效果只改这个文件，不用碰任何逻辑代码。
 */

/**
 * 第一步：判意图。三态 —— 聊天 / 需要澄清 / 直接开工。
 * 关键：需求里没说清「做什么」或「什么风格」时，必须先问，别无脑生成。
 */
export const SYSTEM_ROUTER = `你是需求澄清助手。判断用户这句话属于哪种情况，只输出一个 JSON 对象，不要任何其它文字。

情况 1 —— 聊天（问候、闲聊、问你是谁、问你能做什么）：
{"intent":"chat","reply":"简短友好的中文回复"}

情况 2 —— 想做应用，但需求太模糊，必须先确认才能动手：
{"intent":"clarify","reply":"一句话说明你理解到的方向 + 你要问的那个最关键的问题","options":["选项A","选项B","选项C"]}

情况 3 —— 想做应用，且需求已经足够明确，可以直接做：
{"intent":"build","plan":"- 要点1\\n- 要点2\\n- 要点3"}

判定标准：
- 只说了「做个网页/做个网站/帮我生成个页面」这类没有具体内容的 → clarify
- 说清了是什么应用、或有哪些功能 → build
- 已经说明风格和功能，只差细节 → build（细节可以合理默认，不要为了完美反复问）

options 给 3 个具体可选项，不要写"随便""都行"这种。
plan 为 3-5 条可实现要点，每条一行、以 "- " 开头，只描述这个应用要有什么，不要写"测试""验证"这类人类任务。`

export interface RouterResult {
  intent: 'chat' | 'clarify' | 'build'
  reply: string
  plan: string
  options: string[]
}

/** 解析路由结果。模型不吐 JSON 时兜底当 build —— 绝不因为格式问题卡死流程 */
export function parseRouter(raw: string): RouterResult {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    if (json) {
      const o = JSON.parse(json)
      const intent: RouterResult['intent'] =
        o.intent === 'chat' ? 'chat' : o.intent === 'clarify' ? 'clarify' : 'build'
      return {
        intent,
        reply: typeof o.reply === 'string' ? o.reply : '',
        plan: typeof o.plan === 'string' ? o.plan : '',
        options: Array.isArray(o.options) ? o.options.filter((x: unknown) => typeof x === 'string').slice(0, 4) : [],
      }
    }
  } catch {
    /* 走兜底 */
  }
  return { intent: 'build', reply: '', plan: raw.trim(), options: [] }
}

/**
 * 第二步：生成代码。这是质量的关键。
 */
export const SYSTEM_CODEGEN = `你是资深前端工程师兼设计师。用户给你需求，你产出一个可直接运行、视觉精美的单文件网页。

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
2. 表单要有校验和成功/失败反馈，反馈用页面内提示条，不要用 alert。
3. 列表、表格要有空状态。
4. 禁止出现 TODO、占位符、"示例"、"待补充"。
5. 有数据的地方给出合理的示例数据，让页面看起来是真实在用的。`

/** 组装「生成代码」这条调用的消息数组 */
export function buildCodeMessages(userPrompt: string, plan?: string, prevCode?: string | null) {
  const parts = [`用户需求：${userPrompt}`]
  if (plan) parts.push(`需求拆解：\n${plan}`)
  if (prevCode) {
    parts.push(
      `这是上一版已经生成的完整 HTML，请在此基础上按新需求做增量修改，保留其余部分：\n\`\`\`html\n${prevCode}\n\`\`\``
    )
  }
  return [
    { role: 'system', content: SYSTEM_CODEGEN },
    { role: 'user', content: parts.join('\n\n') },
  ]
}

/** 从模型输出里抠出 HTML：优先吃围栏，兜底吃 <html> 片段 */
export function extractHtml(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const i = raw.search(/<!doctype html|<html/i)
  return i >= 0 ? raw.slice(i).trim() : raw.trim()
}
