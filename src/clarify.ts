/**
 * 需求澄清相关的纯规则。
 *
 * 三个规则各自修过一个真实的用户体验 bug：
 *   1. SKIP_CLARIFY_WORDS —— "就按你默认的来"是【放弃回答】不是【已回答】，
 *      原来被当成已作答直接跳过所有澄清，个人介绍页连"你是谁"都没问过。
 *   2. planIsQuestion —— 模型爱把反问写进 plan，系统照着反问去生成代码，
 *      用户看到的是"一边问我、一边已经把东西做出来了"。
 *   3. askedIdentity —— 以用户本人为中心的页面，放行前必须把身份问到手。
 */

/**
 * 用户说"就按你默认的来"这类话。
 * 注意：这是【放弃回答】，不是【已回答】。
 */
export const SKIP_CLARIFY_WORDS = [
  '就按你默认的来',
  '你定就行',
  '按默认',
  '你决定',
  '随便',
  '都可以',
  '你看着办',
  '你来定',
]

/** 用户明确接受"用占位先做" —— 给过一次跳过权就不再问 */
export const ACCEPT_PLACEHOLDER_WORDS = ['先用占位做', '占位先做', '后面自己改']

/** 澄清历史里是否已经问过「这是谁的页面」 */
export const askedIdentity = (history: { q: string; a: string }[]) =>
  history.some((h) => /(名字|姓名|你是谁|是谁|身份|职业|介绍自己|贵姓)/.test(h.q))

/**
 * plan 里出现问号 = 模型在向用户反问。
 * 这时候【绝不能】照着它生成代码。
 *
 * 判据要同时有问号和疑问词，否则"FAQ 区块""在线问答"这种正常 plan 会被误杀。
 * 模型也爱把反问写成不带问号的陈述句（"请问你想要什么风格"），
 * 这种只有出现明确的问句引导语（请问/想确认…）且引导语在疑问词之前才算反问。
 */
/** 有问号时的疑问词表（「请问」本身也算） */
const QUESTION_WORD = /(吗|呢|哪些|什么|怎么|如何|哪一|要不要|能不能|可以吗|请问|想用|想做)/
/** 无问号时的疑问词表（不含引导语自身，避免位置比较恒假） */
const QUESTION_WORD_NO_LEAD = /(吗|呢|哪些|什么|怎么|如何|哪一|要不要|能不能|可以吗|想用|想做)/

export const planIsQuestion = (plan: string) => {
  const t = plan.trim()
  if (!t) return false
  if (/[？?]/.test(t)) return QUESTION_WORD.test(t)
  const lead = /(请问|想问|想确认|麻烦确认|跟您确认|跟你确认)/.exec(t)
  const word = QUESTION_WORD_NO_LEAD.exec(t)
  return !!lead && !!word && lead.index < word.index
}
