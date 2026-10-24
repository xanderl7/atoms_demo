/**
 * 版本指代解析。
 *
 * 为什么必须在本地做：模型看不到版本历史，"第二版"对它来说是空气 ——
 * 它会猜、会问"你说的是哪个页面"、甚至把"版"理解成"页面数量"。
 * 用户实测踩过这个坑："改成第二版" → 它回"我目前没有第二版的具体信息"。
 *
 * 系统里明明存着每一版，直接切过去就行，不用问模型。
 */

/** 「改回去 / 撤销 / 回退」这类回退意图 —— 系统有版本历史，直接切版本比重新生成快 100 倍 */
const ROLLBACK_WORDS = ['改回去', '回退', '撤销', '还原', '回到上一版', '退回', '上一个版本', '上一步']

export const isRollback = (t: string) => ROLLBACK_WORDS.some((w) => t.includes(w))

/** 中文数字 → 阿拉伯数字，用来解析"第二版" */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/**
 * 用户明确指代某一个版本时，返回该版本的下标；没有指代返回 null。
 *
 * @param total 版本总数
 * @param currentIdx 当前停在第几版（0 起）
 */
export function resolveVersionRef(text: string, total: number, currentIdx: number): number | null {
  if (total <= 1) return null

  // "改成第二版" / "改回第2版" / "回到第 2 版" / "换成第2版那个"
  const m = /第\s*([0-9０-９一二两三十]+)\s*版/.exec(text)
  if (m) {
    const raw = m[1]
    const n = /^[0-9０-９]+$/.test(raw) ? parseInt(raw, 10) : CN_NUM[raw]
    if (n && n >= 1 && n <= total) return n - 1
    return null
  }

  // 回退之后说"改过来吧" = 回到刚才离开的那一版
  if (/(改过来|还是改过来|改回来|回到刚才|刚才那版|刚才那个|刚才的)/.test(text)) {
    if (currentIdx + 1 < total) return currentIdx + 1
  }

  // "上一版 / 前一版"
  if (/(上一版|前一版|上一个版本)/.test(text) && currentIdx > 0) return currentIdx - 1

  // "下一版 / 后一版"
  if (/(下一版|后一版|后面那版|后面那一版)/.test(text) && currentIdx + 1 < total) {
    return currentIdx + 1
  }

  return null
}

/**
 * 把版本历史摘要出来给路由看 —— 模型至少要知道"有几版、每版是啥"。
 * 只取每版 plan/prompt 的第一行，控制长度。
 */
export function buildVersionSummary(
  versions: { plan?: string; prompt: string }[],
  currentIdx: number
): string {
  if (versions.length <= 1) return ''
  const lines = [`版本历史（共 ${versions.length} 版，当前停在第 ${currentIdx + 1} 版）：`]
  versions.forEach((v, i) => {
    const desc = (v.plan || v.prompt || '').split('\n')[0].replace(/^-\s*/, '').slice(0, 60)
    lines.push(`- 第 ${i + 1} 版：${desc}${i === currentIdx ? '  ← 当前' : ''}`)
  })
  lines.push('用户说"改成第 N 版""改回第二版"这类话，指的就是上面某一版。')
  return lines.join('\n')
}
