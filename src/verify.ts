/**
 * 生成代码的静态自检。
 *
 * 为什么需要：模型生成的 HTML 经常带着"结构性硬伤"—— <script> 开合不配对、
 * HTML 标签嵌套错乱、重复 id、表单会刷新页面。这些不用等页面跑起来，
 * 扫一眼代码就能发现，而且每一个都是"页面点了没反应"的根因。
 *
 * 这里只做【确定性的检查】：判据全是可枚举的规则，不猜。
 * 浏览器里直接用 DOMParser；Node 单测环境（happy-dom）也有；
 * 都没有时就跳过 DOM 级检查，只跑正则能查的部分。
 */

export interface StaticIssue {
  message: string
  /** 致命问题：页面基本跑不起来，必须修 */
  fatal?: boolean
}

/** 常见占位/未完成标记 —— 需求里明确禁止这些东西出现在交付里 */
const UNFINISHED = /\bTODO\b|\bFIXME\b|lorem ipsum|待补充|示例文本/i

export function staticCheck(html: string): StaticIssue[] {
  const issues: StaticIssue[] = []
  if (!html || !html.trim()) {
    return [{ message: '生成的代码是空的', fatal: true }]
  }

  // ① <script> 开合配对。少一个 </script>，浏览器会把后面全当成脚本文本，
  //    整个页面的 JS 一起报废 —— 这是最隐蔽也最致命的一种坏。
  const opens = (html.match(/<script\b/gi) || []).length
  const closes = (html.match(/<\/script>/gi) || []).length
  if (opens !== closes) {
    issues.push({
      message: `<script> 标签开合不配对（开 ${opens} 个 / 闭 ${closes} 个）—— 浏览器会把失配处之后的内容全当成脚本文本，页面 JS 整体失效`,
      fatal: true,
    })
  }

  // ② 未完成标记
  const unfinished = UNFINISHED.exec(html)
  if (unfinished) {
    issues.push({
      message: `代码里还有未完成标记「${unfinished[0]}」—— 交付里不该出现占位内容`,
    })
  }

  // ③ DOM 级检查（有 DOMParser 的环境才做）
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')

      if (doc.querySelector('parsererror')) {
        issues.push({
          message: 'HTML 有解析错误（标签没闭合或嵌套错乱）—— 浏览器会按错误方式渲染，布局可能整体崩掉',
          fatal: true,
        })
      }

      // ④ 空页面：既没有可见文字，也没有任何可见元素
      const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, '')
      const hasVisual =
        /<(img|svg|canvas|video|input|button|table|ul|ol|section|div|header|footer|nav|main|aside|form|h[1-6]|p|span|a|figure|picture)\b/i.test(
          html
        )
      if (bodyText.length < 10 && !hasVisual) {
        issues.push({ message: '页面几乎是空的：body 里既没有文字也没有可见元素', fatal: true })
      }

      // ⑤ 重复 id：getElementById 只返回第一个，另一个元素的所有事件全绑不上，
      //    表现就是"点了没反应"。这是模型生成代码的高发错误。
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
      const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
      if (dupIds.length) {
        issues.push({
          message: `有重复的 id：${dupIds.slice(0, 3).join('、')} —— JS 里 getElementById 只能拿到第一个，重复的那个元素会「点了没反应」`,
        })
      }
    } catch {
      // DOMParser 抛意外就跳过 DOM 级检查，正则检查的结果仍然有效
    }
  }

  // ⑥ 表单直拼 action：提交会刷新/跳走页面，页面状态全丢
  if (/<form\b[^>]*\saction\s*=\s*"(?!#)/i.test(html)) {
    issues.push({
      message: '表单设置了 action 提交地址 —— 提交会刷新或跳走页面，必须改为 e.preventDefault() 在页面内处理',
    })
  }

  return issues
}
