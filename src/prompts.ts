/**
 * 提示词集中在这里。生成质量 90% 取决于 SYSTEM_CODEGEN，
 * 想调效果只改这个文件，不用碰任何逻辑代码。
 */

/**
 * 意图路由：先判断用户是想聊天还是要建应用。
 * 和「拆解需求」合并成一次调用 —— 多一轮就多等 2-3 秒，不划算。
 */
export const SYSTEM_ROUTER = `判断用户这句话是想【聊天】还是【做应用】。只输出一个 JSON 对象，不要任何其它文字。

- 问候、闲聊、追问、问你是谁、说谢谢、问"能做什么" → {"intent":"chat","reply":"你的回复，中文，简短友好"}
- 描述想要一个网页/应用/功能，或要修改现有页面 → {"intent":"build","plan":"- 要点1\\n- 要点2\\n- 要点3"}

plan 为 3-5 条可实现要点，每条一行、以 "- " 开头。`

export const SYSTEM_CODEGEN = `你是网页生成引擎。用户给你需求，你只产出一个自包含的 HTML 文件。

硬性约束：
1. 输出且仅输出一个 \`\`\`html 代码块，围栏外不允许出现任何文字。
2. 单个 HTML 文件：CSS 写在 <style> 里，JS 写在 <script> 里，禁止引用本地资源。
3. 允许用 CDN，但必须是 https，例如 https://cdn.tailwindcss.com 。
4. 用原生 DOM API，不要用需要构建的 React / Vue / JSX。
5. 界面文案用中文；排版现代、留白充足、有 hover 和过渡动效。
6. 功能必须真的能跑通，不许留 TODO 或占位符。
7. 如果需求里含图表，用 https://cdn.jsdelivr.net/npm/chart.js 。`

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

export interface RouterResult {
  intent: 'chat' | 'build'
  reply: string
  plan: string
}

/** 解析路由结果。模型不吐 JSON 时兜底当 build，绝不因为格式问题卡死流程 */
export function parseRouter(raw: string): RouterResult {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    if (json) {
      const o = JSON.parse(json)
      return {
        intent: o.intent === 'chat' ? 'chat' : 'build',
        reply: typeof o.reply === 'string' ? o.reply : '',
        plan: typeof o.plan === 'string' ? o.plan : '',
      }
    }
  } catch {
    /* 走兜底 */
  }
  return { intent: 'build', reply: '', plan: raw.trim() }
}

/** 从模型输出里抠出 HTML：优先吃围栏，兜底吃 <html> 片段 */
export function extractHtml(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const i = raw.search(/<!doctype html|<html/i)
  return i >= 0 ? raw.slice(i).trim() : raw.trim()
}
