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

  // 质问/不满里提到某一版，【不是】切换指令。
  // 实测踩坑："你这个第三版是什么东西，完全不是hello world了" ——
  // 含"第三版"，但这是用户在骂这一版跑偏了，不是让它切过去。
  // 不拦的话系统回一句"已切到第 3 版"，用户问东它答西。
  if (isVersionComplaint(text)) return null

  // "改成第二版" / "改回第2版" / "回到第 2 版" / "换成第2版那个"
  //
  // 一句话里可能提到多个版本："第三版完全不对，改回第二版"——
  // 用户要的是第二版，但第一个出现的是"第三版"。有明确切换动词时，
  // 取【最后一个】版本提及（动词的宾语一般跟在动词后面）；
  // 没有切换动词时（"第二版那个区块删掉"）取第一个。
  const mentions = [...text.matchAll(/第\s*([0-9０-９一二两三十]+)\s*版/g)]
  if (mentions.length) {
    const m = SWITCH_VERB.test(text) ? mentions[mentions.length - 1] : mentions[0]
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

/** 明确的切换指令动词 —— 有它说明用户确实要切，质问语气让位 */
const SWITCH_VERB = /(改成|换成|切到|切换|回到|改回|回退|回滚|撤销|还原|退回|调出|打开|还是要|还是用|还是回)/

/**
 * 「结果偏离了需求」—— 比"太丑了"更重：用户认为这一版没满足他最初要的东西。
 * 这类不满的修法是【回到最初的需求重新做】，不是在当前页面上打补丁。
 */
const DRIFT_WORDS =
  /(是什么东西|什么东西|什么玩意|啥东西|完全不是|根本不是|一点都不|完全不对|不是我要|不是我想要|不是我说的|跑偏|偏离|答非所问|牛头不对马嘴|胡说|敷衍|糊弄|乱来)/

/** 质量不满（丑、乱、不对劲）—— 只抑制版本切换，不触发重建 */
const QUALITY_WORDS =
  /(搞错|弄错|不对劲|怎么回事|为什么|为啥|不对|好丑|太丑|难看|乱七八糟|一塌糊涂)/

/** 消息里有没有提到某个版本（第N版/上一版/刚才那版…） */
const MENTIONS_VERSION = /第\s*[0-9０-９一二两三十]+\s*版|上一版|下一版|前一版|后一版|刚才那版|刚才那个|刚才的版本/

/**
 * 这句话是在【质问/不满某个版本】，还是在【指令切换】？
 *
 * 判据：提到了版本 + 有不满词（偏离或质量都算）+ 没有明确切换动词。
 * "你这个第三版是什么东西" → 质问（不切换）
 * "第三版完全不对，改回第二版" → 有切换动词"改回"，仍然切换
 * "还是第一版" → 没有不满词，正常切换
 */
export function isVersionComplaint(text: string): boolean {
  return (
    MENTIONS_VERSION.test(text) &&
    (DRIFT_WORDS.test(text) || QUALITY_WORDS.test(text)) &&
    !SWITCH_VERB.test(text)
  )
}

/**
 * 用户认为【结果脱离了最初的需求】—— 不只是"丑"，是"做错了东西"。
 * 这种不满的修法是从最初需求重新实现，App 里用它决定：
 * 代码生成不喂上一版（prevCode=null），显式带上最初的需求。
 */
export const isDriftComplaint = (t: string) => DRIFT_WORDS.test(t)

/**
 * 用户要【推倒重做】：从最初的需求出发做一个全新的版本，
 * 而不是在当前页面上改。
 *
 * 这类请求的锚点是最初的需求（第 1 版的原始 prompt），不是当前页面 ——
 * 实测踩坑："推倒重做，出一个全新的第三版"被理解成"把当前（已被改成
 * 绿色的）页面重画一遍"，做出了一个跟最初 hello world 无关的绿色网页。
 */
const REBUILD_WORDS =
  /(推倒|重做|重新做|从头做|从零开始|从零构建|做一个全新|出一个全新|来个全新|再来一版|重新来一版|推翻|翻篇)/

export const isRebuild = (t: string) => REBUILD_WORDS.test(t)

/**
 * 把版本历史摘要出来给路由看 —— 模型至少要知道"有几版、每版是啥"。
 *
 * 每版展示两行：用户原话（prompt）+ 做成了什么（plan 第一行）。
 * 用户原话必须放在前面 —— 它是需求的 Ground Truth。
 * 曾经只取 plan 第一行，结果 v1 的 plan 是"创建一个极简的HTML页面"，
 * 用户真正说的"hello world"路由器根本没看见，"推倒重做"时直接把
 * 最初需求弄丢了（实测踩坑）。
 */
export function buildVersionSummary(
  versions: { plan?: string; prompt: string }[],
  currentIdx: number
): string {
  if (versions.length <= 1) return ''
  const lines = [`版本历史（共 ${versions.length} 版，当前停在第 ${currentIdx + 1} 版）：`]
  versions.forEach((v, i) => {
    const said = (v.prompt || '').split('\n')[0].slice(0, 60)
    const made = (v.plan || '').split('\n')[0].replace(/^-\s*/, '').slice(0, 60)
    lines.push(`- 第 ${i + 1} 版：用户说「${said}」→ 做成「${made}」${i === currentIdx ? '  ← 当前' : ''}`)
  })
  lines.push(
    '第 1 版的「用户说」是这个会话【最初的需求】，是一切的核心。' +
      '用户说"推倒重做/重新做一版/全新的第N版"时，从最初的需求出发，' +
      '不要把中间轮改过的样式（换色、调布局）带进新版本，除非他明确说保留。'
  )
  lines.push('用户说"改成第 N 版""改回第二版"这类话，指的就是上面某一版。')
  return lines.join('\n')
}
