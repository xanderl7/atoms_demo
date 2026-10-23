/**
 * 局部编辑：把「改一下」和「重做一个」区分开。
 *
 * 大改动走整篇重写（prompts.ts 的 SYSTEM_CODEGEN）；
 * 小改动走这里 —— 不重发整份代码，只发相关片段，模型只回一段补丁。
 *
 * 三层加速，从快到慢：
 *   1. tryLocalPatch  纯规则改颜色/删区块/改标题，零 LLM 调用、零延迟
 *   2. 定位 + 打补丁   目录 → 选块 → 只把选中的代码喂给模型
 *   3. 降级整篇重写   上面任何一步校验不过，回退到原有路径，保证永远有结果
 */

export interface Block {
  id: string       // 稳定 id：跨版本能对得上同一个区块
  tag: string
  start: number    // 在 html 中的字符区间
  end: number
  title: string    // 给人看的摘要
  len: number
}

export type PatchOp =
  | { type: 'replace_text'; from: string; to: string }
  | { type: 'replace_block'; block: string; content: string }
  | { type: 'remove_block'; block: string }
  | { type: 'insert_after'; block: string; content: string }

/** 顶层容器标签。main 不算 —— 它只是壳，真正的内容在 section 里 */
const TOP_TAGS = ['style', 'script', 'header', 'nav', 'footer', 'section', 'aside']

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/** 给区块算一个跨版本稳定的 id：同样的标签 + 同样的标题 → 同样的 id */
function makeId(tag: string, title: string, used: Map<string, number>): string {
  let h = 0
  const key = `${tag}|${title}`
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const base = `b_${h.toString(36)}`
  const n = (used.get(base) ?? 0) + 1
  used.set(base, n)
  return n === 1 ? base : `${base}_${n}`
}

function pickTitle(tag: string, content: string): string {
  if (tag === 'style') return '全局样式表'
  if (tag === 'script') return '脚本'
  const h = /<h[1-3][^>]*>([\s\S]{0,160}?)<\/h[1-3]>/i.exec(content)
  if (h) {
    const t = stripTags(h[1])
    if (t) return t.slice(0, 40)
  }
  const idm = /\sid="([^"]+)"/i.exec(content)
  if (idm) return `#${idm[1]}`
  const t = stripTags(content)
  return t.slice(0, 40) || '(空区块)'
}

/** 把 HTML 切成顶层区块。改哪个区块 → 只重写哪个区块 */
export function splitBlocks(html: string): Block[] {
  const blocks: Block[] = []
  const used = new Map<string, number>()
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) break
    const m = /^<([a-zA-Z][\w-]*)/.exec(html.slice(lt, lt + 40))
    if (!m) {
      i = lt + 1
      continue
    }
    const tag = m[1].toLowerCase()
    // style/script 交给专用切法（内容里没有配对标签）
    if (tag === 'style' || tag === 'script') {
      const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i')
      const mm = re.exec(html.slice(lt))
      if (mm) {
        const end = lt + mm[0].length
        const title = tag === 'style' ? '全局样式表' : '脚本'
        blocks.push({ id: makeId(tag, title, used), tag, start: lt, end, title, len: end - lt })
        i = end
        continue
      }
    }
    if (!TOP_TAGS.includes(tag)) {
      i = lt + 1
      continue
    }
    // 找配对的结束标签（处理同标签嵌套）
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    re.lastIndex = lt
    let depth = 0
    let end = -1
    let mm2: RegExpExecArray | null
    while ((mm2 = re.exec(html))) {
      if (mm2[1] === '/') {
        depth--
        if (depth === 0) {
          end = mm2.index + mm2[0].length
          break
        }
      } else if (!/\/>$/.test(mm2[0])) {
        depth++
      }
    }
    if (end < 0) {
      i = lt + 1
      continue
    }
    const content = html.slice(lt, end)
    const title = pickTitle(tag, content)
    blocks.push({ id: makeId(tag, title, used), tag, start: lt, end, title, len: end - lt })
    i = end
  }
  return blocks.sort((a, b) => a.start - b.start)
}

/** 区块目录：只给 id + 标题 + 体量，不给正文。模型靠它挑要改哪块 */
export function blockCatalog(blocks: Block[]): string {
  if (!blocks.length) return '(页面没有可切分的区块)'
  return blocks
    .map((b) => `${b.id} | <${b.tag}> ${b.title} | ${b.len}字符`)
    .join('\n')
}

/** 取出指定区块的正文 */
export function blockBody(html: string, blocks: Block[], id: string): string {
  const b = blocks.find((x) => x.id === id)
  return b ? html.slice(b.start, b.end) : ''
}

// ---------------------------------------------------------------- op 执行

export interface ApplyResult {
  ok: boolean
  html: string
  applied: number
  error?: string
}

const isOp = (o: any): o is PatchOp =>
  !!o &&
  typeof o.type === 'string' &&
  (o.type === 'replace_text'
    ? typeof o.from === 'string' && o.from.length > 0
    : o.type === 'replace_block' || o.type === 'insert_after'
      ? typeof o.block === 'string' && typeof o.content === 'string'
      : o.type === 'remove_block'
        ? typeof o.block === 'string'
        : false)

/**
 * 执行补丁。全部校验通过才动手 —— 宁可不做，不能改坏。
 * 校验项：replace_text 的 from 必须逐字符存在于原文；块 id 必须真实存在。
 */
export function applyOps(html: string, ops: PatchOp[], blocks: Block[]): ApplyResult {
  if (!ops.length) return { ok: false, html, applied: 0, error: '补丁为空' }

  for (const op of ops) {
    if (op.type === 'replace_text' && !html.includes(op.from)) {
      return { ok: false, html, applied: 0, error: `要替换的内容在页面里找不到：${op.from.slice(0, 40)}` }
    }
    if (op.type !== 'replace_text' && !blocks.some((b) => b.id === op.block)) {
      return { ok: false, html, applied: 0, error: `区块 id 不存在：${op.block}` }
    }
  }

  let out = html
  let applied = 0

  // 1) 文本替换：全部替换（改颜色一般要一次改全）
  for (const op of ops) {
    if (op.type !== 'replace_text') continue
    out = out.split(op.from).join(op.to)
    applied++
  }

  // 2) 块操作：从后往前切，避免前面的偏移让后面的下标失效
  const blockOps = ops.filter((o) => o.type !== 'replace_text')
  const withIdx = blockOps
    .map((op) => ({ op, b: blocks.find((x) => x.id === (op as any).block)! }))
    .sort((x, y) => y.b.start - x.b.start)

  for (const { op, b } of withIdx) {
    if (op.type === 'remove_block') {
      out = out.slice(0, b.start) + out.slice(b.end)
    } else if (op.type === 'replace_block') {
      out = out.slice(0, b.start) + op.content + out.slice(b.end)
    } else {
      out = out.slice(0, b.end) + op.content + out.slice(b.end)
    }
    applied++
  }

  // 3) 收尾校验：不能把页面改坏
  if (out.length < 50) return { ok: false, html, applied: 0, error: '补丁后页面过短，判定失败' }
  if (!/<\/html>/i.test(out)) return { ok: false, html, applied: 0, error: '补丁后缺少 </html>' }
  if (!/<style/i.test(out)) return { ok: false, html, applied: 0, error: '补丁后样式丢失' }

  return { ok: true, html: out, applied }
}

/**
 * 从模型返回里抠出补丁 JSON。
 *
 * 和路由一样要有容错 —— 模型在字符串里塞真实换行是很常见的，
 * 直接 JSON.parse 会失败。这里解析失败返回 null，由调用方降级整篇重写，
 * 【绝不能】把原始输出当成结果。
 */
export function parsePatch(raw: string): { summary: string; ops: PatchOp[] } | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null

  let o: any = null
  for (const candidate of [json, repairJson(json)]) {
    try {
      o = JSON.parse(candidate)
      break
    } catch {
      /* 试下一个 */
    }
  }
  if (!o) {
    // 最后一招：逐字段抠 ops 数组
    const ops = looseParseOps(json)
    if (!ops.length) return null
    return { summary: '', ops }
  }

  const ops = Array.isArray(o.ops) ? o.ops.filter(isOp).slice(0, 8) : []
  return { summary: typeof o.summary === 'string' ? o.summary : '', ops }
}

/** 把字符串里未转义的控制字符转义掉 */
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

/** JSON 整体坏了，但 ops 数组还在 —— 用正则一个个抠出来 */
function looseParseOps(json: string): PatchOp[] {
  const block = /"ops"\s*:\s*\[([\s\S]*?)\]\s*[,}]/.exec(json)?.[1] ?? ''
  const out: PatchOp[] = []
  // 每个 op 是一个 {...}，用括号配对切出来
  const re = /\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const body = m[1]
    const type = /"type"\s*:\s*"(\w+)"/.exec(body)?.[1]
    if (!type) continue
    const str = (key: string) => {
      const v = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(body)?.[1]
      return v === undefined ? undefined : v.replace(/\\n/g, '\n').replace(/\\"/g, '"')
    }
    if (type === 'replace_text') {
      const from = str('from')
      const to = str('to')
      if (from) out.push({ type, from, to: to ?? '' })
    } else if (type === 'replace_block' || type === 'insert_after') {
      const block2 = str('block')
      const content = str('content')
      if (block2 !== undefined && content !== undefined) out.push({ type, block: block2, content })
    } else if (type === 'remove_block') {
      const block2 = str('block')
      if (block2 !== undefined) out.push({ type, block: block2 })
    }
  }
  return out.slice(0, 8)
}

/**
 * 解析定位结果。返回 null 表示"模型没给出可用 id" → 调用方应降级。
 * 返回 '*' 表示模型认为全局相关。
 */
export function parseLocate(raw: string): string[] | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const o = JSON.parse(json)
    const ids = Array.isArray(o.ids) ? o.ids.filter((x: unknown) => typeof x === 'string') : []
    if (!ids.length) return null
    if (ids.includes('*')) return ['*']
    return ids as string[]
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 本地快改

const COLORS: Record<string, string> = {
  红: '#dc2626', 红色: '#dc2626', 深红: '#991b1b', 酒红: '#9f1239',
  橙: '#ea580c', 橙色: '#ea580c', 黄: '#eab308', 黄色: '#eab308',
  绿: '#16a34a', 绿色: '#16a34a', 深绿: '#166534', 薄荷绿: '#34d399',
  青: '#0891b2', 青色: '#0891b2', 蓝: '#2563eb', 蓝色: '#2563eb', 深蓝: '#1e40af',
  天蓝: '#38bdf8', 紫: '#9333ea', 紫色: '#9333ea', 粉: '#db2777', 粉色: '#db2777',
  黑: '#111827', 白: '#ffffff', 灰: '#6b7280', 灰色: '#6b7280', 金: '#ca8a04',
}

/** 找到页面当前的主色：优先 CSS 变量，其次出现次数最多的 hex */
function findPrimaryColor(html: string): string | null {
  const v = /--(?:primary|brand|main-color|color-primary|accent)\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(html)
  if (v) return v[1]
  const counts = new Map<string, number>()
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) ?? 0) + 1)
  }
  let best: string | null = null
  let n = 0
  for (const [c, k] of counts) {
    if (k > n) {
      n = k
      best = c
    }
  }
  return best
}

/**
 * 抽出句子里用户想要的目标色。
 *
 * 注意两个坑：
 * 1. "深蓝色" 同时包含 "深蓝" 和 "蓝色" —— 必须优先更具体的那个。
 *    做法：先按长度取最长，长度相同时取在句子里出现位置最靠前的。
 * 2. 句子里出现颜色词，不代表用户想改颜色。
 *    "标题改成「红色之夜」" 是改文案，不是改配色 —— 由调用方用语义词排除。
 */
function colorWanted(text: string): string | null {
  let best: { hex: string; len: number; pos: number } | null = null
  for (const k of Object.keys(COLORS)) {
    const pos = text.indexOf(k)
    if (pos < 0) continue
    if (!best || k.length > best.len || (k.length === best.len && pos < best.pos)) {
      best = { hex: COLORS[k], len: k.length, pos }
    }
  }
  return best?.hex ?? null
}

/** 用来排除的通用词：命中说明用户说的不是单纯「删某个区块」 */
const NOISE = ['页面', '区块', '模块', '我的', '这个', '那个', '内容', '标题', '导航', '页脚', '顶部', '底部', '部分', '东西']

/** 句子里提到的区块关键词（取区块标题里的中文/英文词，看句中是否出现） */
function mentionedBlocks(text: string, blocks: Block[]): Block[] {
  const hits: Block[] = []
  for (const b of blocks) {
    if (b.tag === 'style' || b.tag === 'script') continue
    const words = b.title.match(/[一-龥]{2,}|[A-Za-z][A-Za-z0-9]{2,}/g) ?? []
    const matched = words.some((w) => {
      if (w.length < 2 || NOISE.includes(w)) return false
      return text.toLowerCase().includes(w.toLowerCase())
    })
    if (matched) hits.push(b)
  }
  return hits
}

/**
 * 规则快改：改主色 / 删区块 / 改主标题。
 * 只在用户表达非常明确时才动手，判不准就返回 null，交给 LLM。
 */
export function tryLocalPatch(text: string, html: string): { html: string; note: string } | null {
  // --- 改主色 ---
  // 「整体/风格/主题」说明用户想换整套设计，不是改个色值，交给 LLM
  const wantsColor = colorWanted(text)
  const notTheme = !/(整体|风格|主题|重新设计|配色方案|全套)/.test(text)
  // 出现了「标题/文案/文字/内容」等语义词，说明颜色词可能只是文案的一部分
  // 注意不能用「改成」这种通用词判断 —— "把主色调改成红色" 也含「改成」
  const notCopy = !/(标题|文案|文字|内容|名称|说法|写成|叫做|命名)/.test(text)
  if (wantsColor && notTheme && notCopy && /(改|换|变|调整|设置|要|用)/.test(text)) {
    const cur = findPrimaryColor(html)
    if (cur && cur.toLowerCase() !== wantsColor.toLowerCase()) {
      const out = html.split(cur).join(wantsColor)
      // 注意：#2563eb 和 #dc2626 长度一样，不能用长度判断有没有改动
      if (out !== html) {
        return { html: out, note: `主色 ${cur} → ${wantsColor}（本地直接改，没调用模型）` }
      }
    }
  }

  const blocks = splitBlocks(html)

  // --- 删区块 ---
  if (/(删掉|删除|去掉|移除|去除|不要)/.test(text)) {
    const cands = mentionedBlocks(text, blocks)
    if (cands.length === 1) {
      const b = cands[0]
      const out = html.slice(0, b.start) + html.slice(b.end)
      return { html: out, note: `已删除区块「${b.title}」（本地直接删，没调用模型）` }
    }
  }

  // --- 改主标题 ---
  const titleM = /标题(?:改成|换成|改为|变成)\s*["'「]?([^"'」\n，。]{1,30})/.exec(text)
  if (titleM) {
    const newTitle = titleM[1].trim()
    const re = /(<h1[^>]*>)[\s\S]{0,200}?(<\/h1>)/i
    if (re.test(html)) {
      const out = html.replace(re, `$1${newTitle}$2`)
      return { html: out, note: `主标题改成「${newTitle}」（本地直接改，没调用模型）` }
    }
  }

  return null
}
