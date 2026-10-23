/**
 * 提示词集中在这里。生成质量 90% 取决于 SYSTEM_CODEGEN，
 * 想调效果只改这个文件，不用碰任何逻辑代码。
 */

export const SYSTEM_PLAN = `你是需求分析助手。把用户的需求拆解成 3-5 条可实现要点。
要求：每条一行，以 "- " 开头；只写要点，不要解释、不要代码、不要客套。`

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

/** 从模型输出里抠出 HTML：优先吃围栏，兜底吃 <html> 片段 */
export function extractHtml(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const i = raw.search(/<!doctype html|<html/i)
  return i >= 0 ? raw.slice(i).trim() : raw.trim()
}
