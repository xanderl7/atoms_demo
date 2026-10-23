/**
 * 边界说明生成器。
 *
 * 这一层的存在理由：模型不会主动说"我没做什么"，用户看到的是一张看起来
 * 挺像样的页面，以为作品是真的、表单真的能提交。真实情况是：图片是占位图、
 * 文案是占位文案、表单不真的发请求。
 *
 * 所以生成完之后，扫描代码里的占位标记，原原本本告诉用户：
 *   我做了什么 → 哪些是我编的/顶位的 → 你后续怎么改成你自己的
 *
 * 用扫描而不是让模型自己说，是因为扫描的结果是确定的，不会胡编。
 */

export interface LimitNote {
  /** 我做了什么 */
  done: string[]
  /** 我没做什么（用了什么顶位） */
  faked: string[]
  /** 用户后续怎么改 */
  next: string[]
}

/** 数一数代码里出现了多少次某个模式 */
const count = (code: string, re: RegExp) => (code.match(re) ?? []).length

/**
 * 扫描生成的代码，给出"边界说明"。
 * 返回 null 表示没有需要声明的东西（用户提供了全部内容且无表单）。
 */
export function describeLimits(code: string): LimitNote | null {
  const done: string[] = []
  const faked: string[] = []
  const next: string[] = []

  const imgCount = count(code, /picsum\.photos/gi)
  const textCount = count(code, /data-placeholder="text"/gi)
  const formCount = count(code, /<form\b/gi)
  const hasItems = /const\s+ITEMS\s*=/i.test(code)
  const externalMail = count(code, /mailto:/gi)
  const fakeMail = count(code, /@example\.com/gi)

  // --- 图片：用了占位图 ---
  if (imgCount > 0) {
    faked.push(`${imgCount} 张图片是 picsum 占位图，不是你的作品`)
    next.push(
      `换图：切到「代码」视图，把 <img src="https://picsum.photos/..."> 的 src 换成你自己的图片地址（或本地路径）`
    )
  }

  // --- 文案：用了占位文案 ---
  if (textCount > 0) {
    faked.push(`${textCount} 处文案是占位文字（如「作品标题 1」），因为你不支持上传作品、我也没拿到你的真实内容`)
    next.push(`换文案：搜索 data-placeholder="text"，把里面的文字改成你的真实作品名和简介`)
  }

  // --- 数据集中区 ---
  if (hasItems) {
    next.push(
      `批量改：所有内容都集中在 <script> 顶部的 const ITEMS = [...] 里，改这一个数组就能全站生效，不用逐处翻`
    )
  }

  // --- 表单：不真的发请求 ---
  if (formCount > 0) {
    faked.push(`${formCount} 个表单不会真的发出去（这是纯前端页面，没有后端）`)
    next.push(
      `接后端：在表单提交的地方把"显示成功提示"换成 fetch('/api/xxx', {method:'POST'})，就能真的收到留言`
    )
  }

  // --- 邮箱等联系方式 ---
  if (fakeMail > 0 || externalMail > 0) {
    faked.push(`联系方式用的是示例邮箱 hi@example.com，不是你的`)
    next.push(`改联系方式：换成你自己的邮箱或二维码`)
  }

  if (!faked.length && !next.length) return null

  // --- 我做了什么 ---
  const sectionCount = count(code, /<section\b/gi)
  done.push(sectionCount > 0 ? `搭好了完整页面结构（${sectionCount} 个内容区块）` : '搭好了页面结构')
  done.push('配色、排版、响应式、hover 动效都已就位')
  if (formCount > 0) done.push('表单的校验和页面内反馈提示条已做好，点了会有反应')
  done.push('整站是自包含单文件 HTML，下载就能直接用浏览器打开')

  return { done, faked, next }
}

/**
 * 把边界说明渲染成给用户看的一段话。
 * 聊天区是纯文本渲染（不解析 markdown），所以用「──」和缩进做层级。
 */
export function renderLimits(n: LimitNote): string {
  const lines: string[] = ['', '──── 这一版我要跟你说明白 ────']
  if (n.faked.length) {
    lines.push('', '我没做到、用占位顶上去的：')
    n.faked.forEach((x) => lines.push(`  · ${x}`))
  }
  if (n.done.length) {
    lines.push('', '我已经做好的：')
    n.done.forEach((x) => lines.push(`  · ${x}`))
  }
  if (n.next.length) {
    lines.push('', '你后续接手改这几处就行：')
    n.next.forEach((x) => lines.push(`  · ${x}`))
  }
  return lines.join('\n')
}
