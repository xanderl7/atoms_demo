import { useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import PreviewPane from './components/PreviewPane'
import CodePane from './components/CodePane'
import Settings from './components/Settings'
import LogPanel from './components/LogPanel'
import type { AppVersion, Message, Step } from './types'
import { loadConfig, saveConfig, type LLMConfig } from './config'
import { chat, chatStream } from './llm'
import {
  parseRouter,
  buildRouterMessages,
  buildCodeMessages,
  buildPatchMessages,
  buildLocateMessages,
  extractHtml,
} from './prompts'
import {
  splitBlocks,
  blockCatalog,
  blockBody,
  applyOps,
  parsePatch,
  parseLocate,
  tryLocalPatch,
} from './patcher'
import { log } from './logger'
import { useIframeErrors } from './iframeProbe'
import { describeLimits, renderLimits } from './limits'
import { detectUnsupported, renderUnsupported } from './unsupported'
import { detectRefuse, renderRefuse } from './refuse'
import { useAutoFix } from './useAutoFix'

const uid = () => Math.random().toString(36).slice(2, 9)

const STEP_LABELS = [
  { id: 'route', label: '理解需求' },
  { id: 'code', label: '生成代码' },
]

/** 「改回去 / 撤销 / 回退」这类回退意图 —— 系统有版本历史，直接切版本比重新生成快 100 倍 */
const ROLLBACK_WORDS = ['改回去', '回退', '撤销', '还原', '回到上一版', '退回', '上一个版本', '上一步']

const isRollback = (t: string) => ROLLBACK_WORDS.some((w) => t.includes(w))

/** 中文数字 → 阿拉伯数字，用来解析"第二版" */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/**
 * 用户明确指代某一个版本时，直接在版本历史里切过去。
 *
 * 为什么必须本地做：模型看不到版本历史，"第二版"对它来说是空气 ——
 * 它会猜、会问"你说的是哪个页面"、甚至把"版"理解成"页面数量"。
 * 用户实测踩过这个坑："改成第二版" → 它回"我目前没有第二版的具体信息"。
 *
 * 系统里明明存着每一版，直接切过去就行，不用问模型。
 */
function resolveVersionRef(text: string, total: number, currentIdx: number): number | null {
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

/** 把版本历史摘要出来给路由看 —— 模型至少要知道"有几版、每版是啥" */
function buildVersionSummary(versions: AppVersion[], currentIdx: number): string {
  if (versions.length <= 1) return ''
  const lines = [`版本历史（共 ${versions.length} 版，当前停在第 ${currentIdx + 1} 版）：`]
  versions.forEach((v, i) => {
    const desc = (v.plan || v.prompt || '').split('\n')[0].replace(/^-\s*/, '').slice(0, 60)
    lines.push(`- 第 ${i + 1} 版：${desc}${i === currentIdx ? '  ← 当前' : ''}`)
  })
  lines.push('用户说"改成第 N 版""改回第二版"这类话，指的就是上面某一版。')
  return lines.join('\n')
}

const mkSteps = (): Step[] => STEP_LABELS.map((s) => ({ ...s, status: 'pending' }))
const doneSteps = (ids: string[]): Step[] =>
  STEP_LABELS.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, status: 'done' }))

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError'

/**
 * 用户说"就按你默认的来"这类话。
 * 注意：这是【放弃回答】，不是【已回答】。原来的 fromOption 把它当成已作答，
 * 直接跳过后续所有澄清 —— 结果个人介绍页连"你是谁"都没问过就生成了，
 * 满页只能是占位文字。
 */
const SKIP_CLARIFY_WORDS = [
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
const ACCEPT_PLACEHOLDER_WORDS = ['先用占位做', '占位先做', '后面自己改']

/** 澄清历史里是否已经问过「这是谁的页面」 */
const askedIdentity = (history: { q: string; a: string }[]) =>
  history.some((h) => /(名字|姓名|你是谁|是谁|身份|职业|介绍自己|贵姓)/.test(h.q))

/**
 * plan 里出现问号 = 模型在向用户反问。
 * 这时候【绝不能】照着它生成代码 —— 用户截图反馈的 bug 就是这个：
 * 助手气泡先问"你主要想用后端来做什么？"，紧接着"正在生成代码… 5861 字符"，
 * 一边问一边干，用户还没回答，页面已经生成完了。
 *
 * 判据要同时有问号和疑问词，否则"FAQ 区块""在线问答"这种正常 plan 会被误杀。
 */
const planIsQuestion = (plan: string) => {
  const t = plan.trim()
  if (!t || !/[？?]/.test(t)) return false
  return /(吗|呢|哪些|什么|怎么|如何|哪一|要不要|能不能|可以吗|请问|想用|想做)/.test(t)
}

export default function App() {
  const [cfg, setCfg] = useState<LLMConfig>(loadConfig)
  const [showSettings, setShowSettings] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), role: 'assistant', content: '你好，描述一个你想要的应用，我来帮你把它做出来。' },
  ])
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  /** 上一轮问了澄清问题，用户这次的回答要跟原需求合并后再生成 */
  const pendingRef = useRef<string | null>(null)
  /** 已经问了几轮澄清。超过 3 轮就放行，别做成问卷 */
  const [clarifyRounds, setClarifyRounds] = useState(0)
  /** 澄清历史：我问了什么、用户答了什么。传给路由让它有全貌 */
  const [clarifyHistory, setClarifyHistory] = useState<{ q: string; a: string }[]>([])
  /**
   * 上一次摆给用户点的选项。
   * 用户点了选项 = 已经作答，这一轮【不许再追问】，必须直接出东西 ——
   * 否则就成了"你答完我再问一遍"，体验很糟。
   */
  const lastOptionsRef = useRef<string[]>([])
  /** 预览区里 iframe 报出来的运行时错误 —— 「点了没反应」的真相 */
  const frameErrors = useIframeErrors(reloadKey)
  /** 报错条默认折叠，别把预览区顶部压掉 */
  const [errOpen, setErrOpen] = useState(false)
  /** 是否已经问过「这是谁的页面」。问过一次就给过跳过权，不再追问 */
  const identityAskedRef = useRef(false)
  /** 当前这轮生成对应的助手消息 id —— 自检修复的过程汇报写进这条消息 */
  const genMsgRef = useRef<string | null>(null)

  // 生成时每秒 +1，让人看到「在跑」而不是「卡住」。
  // busy 是内部状态变化（不是 prop），React 的"渲染期重置 state"模式不适用；
  // 而秒表必须在计时开始那一刻归零，晚一个 tick 用户就会看到从旧值往上跳。
  useEffect(() => {
    if (!busy) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const current = versions[currentIdx]

  // ── 自检 + 自动修复闭环 ────────────────────────────────
  //
  // 生成/修改完不是终点。页面在 iframe 里跑挂了（JS 语法错误、事件没绑上、
  // 重复 id…），用户在预览里只看到"点了没反应"，根本不知道该说什么。
  // 所以每次提交新版本后自动跑一轮：静态检查 → 等 iframe 加载收集真实
  // 运行时错误 → 有问题直接回喂模型修（最多 2 轮）→ 修不完如实告知。
  const autoFix = useAutoFix({
    cfg,
    current,
    frameErrors,
    busy,
    commit: (code) => {
      setVersions((p) => [
        ...p,
        {
          id: uid(),
          prompt: `（自检自动修复）${current?.prompt ?? ''}`.trim(),
          plan: current?.plan,
          code,
          createdAt: Date.now(),
        },
      ])
      setCurrentIdx((i) => i + 1)
      setReloadKey((k) => k + 1)
    },
    report: (text) => {
      const id = genMsgRef.current
      if (!id) return
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m))
      )
    },
    setBusy,
    abortRef,
  })

  /** 提交一个新版本，并 arm 自检闭环（回退/切版本不 arm —— 那是历史版本，不重新检） */
  const commitVersion = (code: string, prompt: string, plan?: string) => {
    setVersions((p) => [...p, { id: uid(), prompt, plan, code, createdAt: Date.now() }])
    setCurrentIdx((i) => i + 1)
    setReloadKey((k) => k + 1)
    autoFix.arm()
  }

  const patchMsg = (id: string, patch: Partial<Message>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const setStep = (msgId: string, stepId: string, status: Step['status']) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, steps: m.steps?.map((s) => (s.id === stepId ? { ...s, status } : s)) }
          : m
      )
    )

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function handleSend(text: string) {
    const t0 = Date.now()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    // 用户是不是点的我给的选项？是的话这一轮必须出东西，不许再追问
    const fromOption = lastOptionsRef.current.includes(text)
    lastOptionsRef.current = []

    // 上一轮澄清过：把回答跟原需求拼起来，这次直接开工，不再重复问
    const original = pendingRef.current
    pendingRef.current = null
    const enriched = original
      ? `需求：${original}\n\n补充确认：${text}`
      : text

    log.info('send', original ? '收到澄清回答，合并原需求' : '收到用户输入', { text, original })

    setBusy(true)
    setMessages((p) => [...p, { id: uid(), role: 'user', content: text }])

    // 「改回去 / 撤销」：版本历史里本来就有，直接切回去即可，
    // 不要浪费一分钟去让模型重写 —— 它看不到历史，只能照着当前版再吐一遍
    if (isRollback(text) && versions.length > 1) {
      const target = currentIdx > 0 ? currentIdx - 1 : 0
      setCurrentIdx(target)
      setReloadKey((k) => k + 1)
      log.info('rollback', `回退到第 ${target + 1} 版（共 ${versions.length} 版）`, {
        from: currentIdx + 1,
        to: target + 1,
      })
      setMessages((p) => [
        ...p,
        {
          id: uid(),
          role: 'assistant',
          content: `已回到第 ${target + 1} 版（共 ${versions.length} 版）。这是版本历史里直接切回去的，没有重新生成。`,
        },
      ])
      setBusy(false)
      return
    }

    // 「改成第二版 / 改回第2版 / 改过来吧」—— 明确指代某一版，
    // 直接在版本历史里切过去。让模型干这事它只会猜（实测踩过坑）。
    const versionTarget = resolveVersionRef(text, versions.length, currentIdx)
    if (versionTarget !== null) {
      // 已经停在目标版本了 —— 也要拦住，不能落到生成流程。
      // 否则用户说"改成第二版"而当前正是第 2 版时，会白白重新生成一版（70s）。
      if (versionTarget === currentIdx) {
        log.info('version-switch', `已经在第 ${currentIdx + 1} 版，无需切换`)
        setMessages((p) => [
          ...p,
          {
            id: uid(),
            role: 'assistant',
            content: `当前已经在第 ${currentIdx + 1} 版了（共 ${versions.length} 版），不用改。\n如果你想在这一版基础上改点别的，直接说改什么就行。`,
          },
        ])
        setBusy(false)
        return
      }
      setCurrentIdx(versionTarget)
      setReloadKey((k) => k + 1)
      log.info('version-switch', `切到第 ${versionTarget + 1} 版（共 ${versions.length} 版）`, {
        from: currentIdx + 1,
        to: versionTarget + 1,
      })
      setMessages((p) => [
        ...p,
        {
          id: uid(),
          role: 'assistant',
          content: `已切到第 ${versionTarget + 1} 版（共 ${versions.length} 版）。这是版本历史里直接切过去的，没有重新生成。`,
        },
      ])
      setBusy(false)
      return
    }

    if (!cfg.apiKey) {
      setShowSettings(true)
      setMessages((p) => [
        ...p,
        { id: uid(), role: 'assistant', content: '请先在右上角 ⚙︎ 里填写 API Key，然后重新发送。' },
      ])
      setBusy(false)
      return
    }

    // ── 页面之外 / 功能之外的请求：明确拒绝，不糊弄 ────────────
    //
    // 用户原话："如果是页面之外的东西，还有他功能之外的东西，强调让他拒绝"。
    //
    // 之前"帮我做后端"会被做成一个"后台管理界面示意版" —— 那看着像后端，
    // 其实不是，等于糊弄人。用户明确否掉了这个做法。
    //
    // 走本地规则而不是让模型判断：产品边界不能靠自觉。命中就必然拒绝。
    const refuseKind = detectRefuse(enriched)
    if (refuseKind) {
      log.info('refuse', `拒绝页面之外的请求：${refuseKind}`, { text: enriched.slice(0, 120) })
      setMessages((p) => [
        ...p,
        { id: uid(), role: 'assistant', content: renderRefuse(refuseKind), steps: doneSteps(['route']) },
      ])
      setBusy(false)
      return
    }

    // ── 我们做不到的事：引导用户自己完成，绝不胡编乱造 ──────────
    //
    // 用户说"把作品换成真实作品""用我的照片" —— 这个应用没有上传入口，
    // 收不到文件。这时候有两种烂做法：① 反问"你能提供吗"（问了也收不到，
    // 白白浪费一轮）；② 编一批看起来很真的假作品顶上去（用户以为那是
    // 自己的，真的很糟）。正确做法是告诉他自己改哪几处。
    //
    // 这里走【本地规则】而不是让模型判断：模型在这种地方最容易滑向
    // "那我先给你编几个示例"。关键词匹配是确定的，命中就必然引导。
    //
    // 只在【已有页面】时拦截：第一次做页面时用户说"用我的照片"，页面
    // 还是要做的（图片留占位 + 告诉他怎么换），不该一句话把人打发走。
    if (current && detectUnsupported(enriched)) {
      const guide = renderUnsupported('upload', current.code)
      log.info('handoff', '用户要求使用真实素材，引导他自己改', { text: enriched.slice(0, 120) })
      setMessages((p) => [
        ...p,
        { id: uid(), role: 'assistant', content: guide, steps: doneSteps(['route']) },
      ])
      setBusy(false)
      return
    }

    // ── 最后一问：这是谁的页面 ──────────────────────────────
    //
    // 用户说"就按你默认的来"时会放行，但个人介绍页 / 简历这类以用户为中心的页面，
    // 不知道用户是谁就只能满页占位文字 —— 那这页做了也白做。
    //
    // 原来的 bug：fromOption 把"就按你默认的来"当成"用户已作答"，
    // 直接跳过后续所有澄清，连问都没问过就生成。
    //
    // 这里补一道：放行前必须把身份问到手，但只问一次，且给明确的跳过权。
    if (
      !current &&
      SKIP_CLARIFY_WORDS.some((w) => text.includes(w)) &&
      !ACCEPT_PLACEHOLDER_WORDS.some((w) => text.includes(w)) &&
      !identityAskedRef.current &&
      !askedIdentity(clarifyHistory)
    ) {
      identityAskedRef.current = true
      const opts = ['先用占位做，我后面自己改', '我告诉你我的名字和职业']
      lastOptionsRef.current = opts
      // 保留原始需求：用户点"先用占位做"后，模型还得知道要做的是什么页面
      pendingRef.current = original || text
      log.info('clarify', '放行前追问身份信息', { text: enriched.slice(0, 120) })
      setMessages((p) => [
        ...p,
        {
          id: uid(),
          role: 'assistant',
          content:
            '生成之前还差一个关键信息：这是谁的页面？\n\n' +
            '告诉我你的名字和职业（一句话就行），我直接做进去。\n' +
            '或者选「先用占位做，我后面自己改」—— 那这页的身份信息就全是占位文字，你后面自己替换。',
          steps: doneSteps(['route']),
          options: opts,
        },
      ])
      setBusy(false)
      return
    }

    const botId = uid()
    genMsgRef.current = botId
    setMessages((p) => [...p, { id: botId, role: 'assistant', content: '', steps: mkSteps() }])

    try {
      // ---- Step 1: 判意图 ----
      setStep(botId, 'route', 'running')
      const t1 = Date.now()
      const raw = await chat(
        cfg,
        buildRouterMessages(
          enriched,
          !!current,
          clarifyHistory,
          buildVersionSummary(versions, currentIdx)
        ),
        0.2,
        signal
      )
      log.info('route', `意图判断完成 ${Date.now() - t1}ms`, { raw: raw.slice(0, 400) })
      const r = parseRouter(raw)
      log.info('route', `判定结果 intent=${r.intent}`)
      setStep(botId, 'route', 'done')

      // 聊天：只回文字
      if (r.intent === 'chat') {
        patchMsg(botId, {
          content: r.reply || '你好！描述一个你想要的应用，我来帮你做出来。',
          steps: doneSteps(['route']),
        })
        setBusy(false)
        return
      }

      // 第二道保险：模型也判成 refuse（本地关键词没命中，但模型听懂了）
      if (r.intent === 'refuse') {
        log.info('refuse', '路由判定 refuse', { text: enriched.slice(0, 120) })
        patchMsg(botId, {
          content: renderRefuse('backend'),
          steps: doneSteps(['route']),
        })
        setBusy(false)
        return
      }

      // 第二道保险：模型也判成 handoff（本地关键词没命中，但模型听懂了）
      if (r.intent === 'handoff') {
        const guide = renderUnsupported('upload', current?.code ?? '')
        log.info('handoff', '路由判定 handoff', { text: enriched.slice(0, 120) })
        patchMsg(botId, { content: guide, steps: doneSteps(['route']) })
        setBusy(false)
        return
      }

      // 用户在质疑上一版：不要道歉，要把问题抛回去问清楚。
      // 这一步是关键 —— 之前模型只会说"抱歉"，等于什么都没解决。
      if (r.intent === 'probe' && !fromOption) {
        pendingRef.current = text
        const opts = r.options?.length
          ? r.options
          : ['视觉样式不对', '内容结构不对', '功能逻辑不对']
        lastOptionsRef.current = opts
        patchMsg(botId, {
          content:
            r.reply ||
            '我确认一下具体是哪里不对：是视觉样式不对、内容不对，还是功能逻辑不对？',
          steps: doneSteps(['route']),
          options: opts,
        })
        setBusy(false)
        return
      }

      // 需求模糊：先问清楚，把选项摆给用户点，不急着生成。
      //
      // 关键：澄清是【可以连续多轮】的。之前这里写着 !original，导致用户回答了
      // 第一个问题后就不再问了 —— 用户说"作品集展示页"（还是很宽泛），
      // 系统就直接开干，编了一堆假作品。现在允许接着追问。
      // 但最多问 3 轮，不然就成了问卷。
      if (r.intent === 'clarify' && !current && clarifyRounds < 3 && !fromOption) {
        pendingRef.current = text
        setClarifyRounds((n) => n + 1)
        const opts = [...(r.options ?? []), '就按你默认的来']
        lastOptionsRef.current = opts
        // 记下「我问了什么 / 用户答了什么」，下一轮路由要看到全貌才知道该不该继续问
        setClarifyHistory((h) => [
          ...h,
          { q: r.reply || '（未说明问题）', a: text },
        ])
        log.info('clarify', `第 ${clarifyRounds + 1} 轮澄清`, { reply: r.reply })
        patchMsg(botId, {
          content: r.reply || '我还不太确定你想要什么，先确认一下：',
          steps: doneSteps(['route']),
          options: opts,
        })
        setBusy(false)
        return
      }

      // ---- Step 2: 拆需求 ----
      setStep(botId, 'plan', 'running')
      const plan = r.plan || (r.reply ? `- ${r.reply}` : '')
      setStep(botId, 'plan', 'done')

      // ── plan 是反问 → 停下来问，绝不生成 ────────────────────
      // 模型经常把"你主要想用后端来做什么？"这种反问写进 plan 字段，
      // 然后系统就照着这句反问去生成代码了 —— 用户看到的是
      // "一边问我、一边已经把东西做出来了"。
      //
      // fromOption 时除外：用户点了选项就是已经作答，这轮必须出东西。
      if (planIsQuestion(plan) && !fromOption) {
        const opts = ['你定就行，按默认的来', '我再补充说明']
        pendingRef.current = text
        lastOptionsRef.current = opts
        setClarifyHistory((h) => [...h, { q: plan, a: text }])
        log.info('clarify', 'plan 里是反问，改为先问清楚', { plan: plan.slice(0, 120) })
        patchMsg(botId, { content: plan, steps: doneSteps(['route']), options: opts })
        setBusy(false)
        return
      }

      patchMsg(botId, { content: plan })

      // ---- 局部修改：不重发全文，只发相关区块 ----
      if (r.intent === 'patch' && current) {
        setStep(botId, 'code', 'running')

        // 三级降级：本地规则 → 定位+补丁 → 整篇重写
        // 每一级都比上一级贵，所以从最便宜的开始试
        const local = tryLocalPatch(enriched, current.code)
        if (local) {
          log.info('patch', `本地规则命中，0 次 LLM 调用`, { note: local.note })
          commitVersion(local.html, enriched, plan)
          setStep(botId, 'code', 'done')
          patchMsg(botId, {
            content: `${plan}\n\n${local.note}\n\n耗时 ${Math.round((Date.now() - t0) / 1000)}s，右侧已更新。`,
          })
          return
        }

        // 2a) 定位：只传区块目录（几百字符），让模型挑要改哪几块
        const blocks = splitBlocks(current.code)
        const catalog = blockCatalog(blocks)
        log.info('patch', `定位区块，共 ${blocks.length} 个，目录 ${catalog.length} 字符`)
        const locRaw = await chat(cfg, buildLocateMessages(enriched, catalog), 0.2, signal)
        const ids = parseLocate(locRaw)
        log.info('patch', `定位结果：${ids ? ids.join(',') : '解析失败'}`)

        if (ids && ids.length) {
          const picked = ids.includes('*') ? blocks : blocks.filter((b) => ids.includes(b.id))
          const selected = picked.map((b) => ({
            id: b.id,
            title: b.title,
            body: blockBody(current.code, blocks, b.id),
          }))

          // 2b) 打补丁：只把这几块正文给模型，它只回补丁不回全文
          if (selected.length) {
            const patchRaw = await chat(
              cfg,
              buildPatchMessages(enriched, catalog, selected, plan),
              0.2,
              signal
            )
            const p = parsePatch(patchRaw)
            log.info('patch', `补丁解析：${p ? `${p.ops.length} 个操作` : '失败'}`, {
              summary: p?.summary,
              raw: patchRaw.slice(0, 300),
            })

            if (p && p.ops.length) {
              const res = applyOps(current.code, p.ops, blocks)
              log.info('patch', `补丁执行：${res.ok ? '成功' : '失败'}`, {
                applied: res.applied,
                error: res.error,
              })
              if (res.ok) {
                commitVersion(res.html, enriched, plan)
                setStep(botId, 'code', 'done')
                patchMsg(botId, {
                  content: `${plan}\n\n${p.summary || '已局部修改'}（改了 ${res.applied} 处，耗时 ${Math.round(
                    (Date.now() - t0) / 1000
                  )}s）。\n只重写了相关区块，没动其它部分。`,
                })
                return
              }
            }
          }
        }

        // 补丁走不通 → 降级整篇重写，保证用户永远拿到结果
        log.warn('patch', '补丁路径失败，降级为整篇重写')
        patchMsg(botId, { content: `${plan}\n\n局部修改没匹配上，改用整页重写…` })
      }

      // ---- Step 3: 生成代码 ----
      setStep(botId, 'code', 'running')
      const t2 = Date.now()
      // 用流式：长连接一直有数据流动，不容易被网关掐断返回 500；
      // 顺带能实时显示进度，用户知道在跑
      let lastPaint = 0
      const rawCode = await chatStream(
        cfg,
        buildCodeMessages(enriched, plan, current?.code ?? null),
        (_chunk, full) => {
          const now = Date.now()
          if (now - lastPaint > 400) {
            lastPaint = now
            patchMsg(botId, { content: `${plan}\n\n正在生成代码… ${full.length} 字符` })
          }
        },
        0.4, // temperature 压低：代码要稳，别发挥
        signal
      )
      const code = extractHtml(rawCode)
      log.info('codegen', `生成完成 ${Date.now() - t2}ms，${rawCode.length} 字符`, {
        fenced: /```html/.test(rawCode),
        codeLen: code.length,
        head: code.slice(0, 120),
        tail: code.slice(-80),
      })

      if (!code || code.length < 50) {
        throw new Error(`模型没返回可用代码（长度 ${code.length}），原始返回：${rawCode.slice(0, 200)}`)
      }

      commitVersion(code, enriched, plan)
      setStep(botId, 'code', 'done')

      // 把「我做了什么 / 我没做什么 / 你后续怎么改」讲清楚。
      // 不靠模型自觉 —— 直接扫代码里的占位标记，结果是确定的。
      const limits = describeLimits(code)
      log.info('limits', limits ? `需要声明 ${limits.faked.length} 项边界` : '无占位内容')
      patchMsg(botId, {
        content:
          `${plan}\n\n已生成 ${code.length} 字符（耗时 ${Math.round((Date.now() - t0) / 1000)}s），右侧可预览。` +
          (limits ? `\n${renderLimits(limits)}` : ''),
      })
    } catch (e: unknown) {
      const err = (e ?? {}) as { message?: string; stack?: string }
      if (isAbort(e)) {
        log.warn('abort', '用户中断了生成')
        patchMsg(botId, {
          content: '已中断。',
          steps: mkSteps().map((s) => ({ ...s, status: 'error' as const })),
        })
      } else {
        log.error('error', `生成失败：${err.message}`, { stack: err.stack?.slice(0, 300) })
        setMessages((p) =>
          p.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  content: `生成失败：${err.message}\n\n右上角「日志」里有完整过程。`,
                  steps: m.steps?.map((s) => ({ ...s, status: 'error' as const })),
                }
              : m
          )
        )
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          LIU XU<span>’</span>s Atoms Demo
        </div>
        <div className="spacer" />
        <div className="segmented">
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>
            预览
          </button>
          <button className={view === 'code' ? 'on' : ''} onClick={() => setView('code')}>
            代码
          </button>
        </div>
        <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)}>
          刷新
        </button>
        <button className="icon-btn" onClick={() => setShowLog(true)}>
          日志
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="模型设置">
          ⚙︎
        </button>
      </div>

      <div className="main">
        <ChatPanel
          messages={messages}
          busy={busy}
          elapsed={elapsed}
          onSend={handleSend}
          onStop={stop}
        />
        {/* 两个视图都常驻挂载，只用 hidden 切换显隐。
            之前是 {view === 'preview' ? <PreviewPane/> : <CodePane/>}，
            一切换就卸载 iframe —— 切回预览时 iframe 重建、页面重新加载，
            用户看到的就是白屏闪一下。常驻就不会。 */}
        <div className="stage-area">
          <div className="preview-wrap" hidden={view !== 'preview'}>
            {/* iframe 里跑挂了要看得见 —— 否则用户只看到"点了没反应" */}
            {frameErrors.length > 0 && (
              <div className="frame-errors">
                <div className="fe-head">
                  <span>预览里有 {frameErrors.length} 个运行时问题</span>
                  <span className="fe-actions">
                    {/* 默认折叠成一行，别把预览区顶部压掉 */}
                    <button className="fe-toggle" onClick={() => setErrOpen((v) => !v)}>
                      {errOpen ? '收起' : '详情'}
                    </button>
                    <button
                      className="fe-fix"
                      onClick={() => {
                        const last = frameErrors[frameErrors.length - 1]
                        void handleSend(
                          `页面运行时报错：${last.message}\n请修好这个错误，让相关交互能正常工作。`
                        )
                      }}
                    >
                      让 AI 修
                    </button>
                  </span>
                </div>
                {errOpen &&
                  frameErrors.map((e, i) => (
                    <div key={i} className="fe-item">
                      {e.message}
                      {e.line ? <span className="fe-loc"> (行 {e.line})</span> : null}
                    </div>
                  ))}
              </div>
            )}
            <PreviewPane code={current?.code ?? ''} reloadKey={reloadKey} />
          </div>

          <div className="code-wrap" hidden={view !== 'code'}>
            <CodePane code={current?.code ?? ''} />
          </div>
        </div>
      </div>

      {showSettings && (
        <Settings
          value={cfg}
          onSave={(c) => {
            setCfg(c)
            saveConfig(c)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLog && <LogPanel onClose={() => setShowLog(false)} />}
    </div>
  )
}
