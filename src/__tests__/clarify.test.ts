import { describe, it, expect } from 'vitest'
import {
  SKIP_CLARIFY_WORDS,
  ACCEPT_PLACEHOLDER_WORDS,
  askedIdentity,
  planIsQuestion,
} from '../clarify'

describe('澄清词表', () => {
  it('SKIP 词覆盖常见"你定吧"说法', () => {
    for (const w of ['就按你默认的来', '随便', '都可以', '你看着办']) {
      expect(SKIP_CLARIFY_WORDS).toContain(w)
    }
  })

  it('ACCEPT 词是明确的占位授权', () => {
    expect(ACCEPT_PLACEHOLDER_WORDS).toContain('先用占位做')
  })
})

describe('askedIdentity 身份是否问过', () => {
  it('问过姓名/职业 → true', () => {
    expect(askedIdentity([{ q: '请问你的名字和职业是什么？', a: '' }])).toBe(true)
    expect(askedIdentity([{ q: '这是谁的页面', a: '' }])).toBe(true)
  })

  it('没问过 → false', () => {
    expect(askedIdentity([{ q: '你想做什么类型的网页？', a: '作品集' }])).toBe(false)
    expect(askedIdentity([])).toBe(false)
  })
})

describe('planIsQuestion plan 是不是反问', () => {
  it('反问必须拦住', () => {
    expect(planIsQuestion('你主要想用后端来做什么？')).toBe(true)
    expect(planIsQuestion('要不要加一个联系表单？')).toBe(true)
    expect(planIsQuestion('请问你想要什么风格')).toBe(true)
    // 无问号但含引导语 + 疑问词（引导语在前）也要拦住
    expect(planIsQuestion('想确认一下你希望什么配色')).toBe(true)
  })

  it('正常 plan 不能误杀（FAQ/问答这种带问句词但不是反问）', () => {
    expect(planIsQuestion('- 顶部 Hero 区\n- FAQ 常见问题区块\n- 在线问答模块')).toBe(false)
    expect(planIsQuestion('- 加一个搜索框，可以按关键词筛选')).toBe(false)
    expect(planIsQuestion('')).toBe(false)
    // 有问号时「请问」单独也算（保持原有判据，防回退）
    expect(planIsQuestion('请问你的名字？')).toBe(true)
    // 引导语在疑问词之后不是反问语序
    expect(planIsQuestion('做什么风格请问')).toBe(false)
  })
})
