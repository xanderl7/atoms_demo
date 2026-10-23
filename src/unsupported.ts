/**
 * 「我们做不到的事」的识别与引导。
 *
 * 背景：用户会说"帮我把作品换成真实作品""用我的照片""上传我的简历"。
 * 这个产品没有上传入口 —— 收不到任何文件。所以这类请求有两条路：
 *   ❌ 反问"你能提供素材吗"（问了也收不到，纯浪费一轮）
 *   ❌ 编一批看起来很真的作品/照片顶上去（用户以为那是自己的，真的很糟）
 * 唯一正确的路：告诉他【你自己在哪几处改】，并且不编。
 *
 * 为什么用本地规则而不是让模型判断：模型在这种"我想帮你但帮不了"的地方
 * 最容易滑向"那我先给你编几个示例"—— 那正是用户最不想要的。
 * 关键词匹配是确定的，命中就必然走引导分支，绝不会编。
 */
import { describeLimits } from './limits'

export type UnsupportedKind = 'upload'

/**
 * 明确在要求"给我文件 / 我自己上传"的词。
 * 注意中间可能夹量词（"传几张作品图"），所以动词后面允许跟几个字。
 */
const UPLOAD_VERB =
  /(上传|传(过来|给我|上来|一下|几张|几本|点|些)?|发(我|过来|给我)|附(上|件)|提供(素材|文件|图片))/

/**
 * 资产类名词 —— 我们真的收不到的东西。
 * "作品集"是页面类型不是素材，所以排除掉。
 */
const ASSET_NOUN = /(作品(?!集)|图片?|照片|素材|文件|头像|logo|LOGO|视频|附件|简历|证书|证件照)/

/**
 * 要求把内容换成"我的 / 真实的东西"。
 * 动词后面可能直接跟资产名词（"用我的照片"），
 * 也可能先跟"我自己的"再跟名词（"换成我自己的照片"）——
 * 所以"我的"这一段做成可选。
 */
const REPLACE_TO_MINE =
  /(换成|替换成|改成|填入|加入|用|变为|变)(我(的|自己的)?|真实(的)?|真(的)?|本人的|实际(的)?)?(作品(?!集)|图片?|照片|素材|文件|头像|logo|LOGO|视频|附件|简历)/

/** 文本类后缀 —— 出现这些说明用户其实是要改文字，不是要传文件 */
const TEXT_SUFFIX = /(名|简介|描述|文案|标题|文字|说明|介绍|标语|口号|字段|集)/

/**
 * "把X换成我自己的" —— 资产名词在前、"我的"在后，结构跟上面那条不同，
 * 所以单独判：资产名词 + 中间隔几个字 + 我的/真实的。
 */
const REPLACE_MINE_TAIL =
  /(作品(?!集)|图片?|照片|素材|文件|头像|logo|LOGO|视频|附件|简历)[^。！？\n]{0,8}(换成|替换成|改成|填入|变成|变|用)[^。！？\n]{0,4}(我(的|自己的)?|真实(的)?|真(的)?|本人的)/

/**
 * 判断这句话是不是"要求我使用你上传的真实素材"。
 * 命中 → 走引导分支，绝不编造。
 */
export function detectUnsupported(text: string): UnsupportedKind | null {
  const t = text.trim()
  if (!t) return null

  // 1) 直接说要上传 → 一定是我们做不到的
  if (UPLOAD_VERB.test(t) && ASSET_NOUN.test(t)) return 'upload'

  // 2) "换成我的X" —— 但要排除"换成我的作品名/我的文案"这种改文字的请求
  const m = REPLACE_TO_MINE.exec(t)
  if (m) {
    const tail = t.slice(m.index + m[0].length)
    if (!TEXT_SUFFIX.test(tail)) return 'upload'
  }

  // 3) "把图片换成我自己的" —— 资产名词在前
  if (REPLACE_MINE_TAIL.test(t)) return 'upload'

  return null
}

/**
 * 生成"你自己怎么改"的引导。
 * 关键：改哪几处是从当前代码里【扫出来的】，不是模型编的。
 */
export function renderUnsupported(kind: UnsupportedKind, code: string): string {
  const limits = describeLimits(code)
  const lines: string[] = []

  lines.push('这个我做不到，得跟你说清楚：这个应用没有上传入口，收不到你的图片/文件。')
  lines.push('')
  lines.push('所以我也不会给你编一批假的作品顶上去 —— 那看着像真的，其实不是你的。')

  if (limits && limits.faked.length) {
    lines.push('')
    lines.push('现在页面里这些是占位内容（我扫了一遍代码，数出来的）：')
    limits.faked.forEach((x) => lines.push(`  · ${x}`))
  }

  if (limits && limits.next.length) {
    lines.push('')
    lines.push('你自己动手改的话，就改这几处：')
    limits.next.forEach((x) => lines.push(`  · ${x}`))
  } else {
    lines.push('')
    lines.push('等你把页面做出来后，改的位置就在「代码」视图里：')
    lines.push('  · 图片：搜 picsum.photos，把 src 换成你自己的图片地址')
    lines.push('  · 文案：搜 data-placeholder="text"，把里面的字改成你的真实内容')
  }

  lines.push('')
  lines.push('另一条路：作品名、简介、联系方式这些【文字】你直接发给我，我能帮你填进页面里。')

  return lines.join('\n')
}
