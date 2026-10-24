import { describe, it, expect } from 'vitest'
import {
  isRollback,
  resolveVersionRef,
  buildVersionSummary,
  isRebuild,
  isDriftComplaint,
  isVersionComplaint,
} from '../versionRef'

describe('isRollback 回退意图', () => {
  it('命中回退词', () => {
    expect(isRollback('改回去')).toBe(true)
    expect(isRollback('撤销这个修改')).toBe(true)
    expect(isRollback('回到上一版')).toBe(true)
  })

  it('普通修改不是回退', () => {
    expect(isRollback('把主色改成绿色')).toBe(false)
    expect(isRollback('改成第二版')).toBe(false) // 这是版本指代，不是回退
  })
})

describe('resolveVersionRef 版本指代', () => {
  it('「改成第二版」→ 下标 1', () => {
    expect(resolveVersionRef('改成第二版', 3, 0)).toBe(1)
    expect(resolveVersionRef('改回第2版', 3, 0)).toBe(1)
    expect(resolveVersionRef('回到第 2 版', 3, 0)).toBe(1)
    expect(resolveVersionRef('换成第2版那个', 3, 0)).toBe(1)
  })

  it('中文数字和阿拉伯数字都认', () => {
    expect(resolveVersionRef('改成第三版', 3, 0)).toBe(2)
    expect(resolveVersionRef('改成第3版', 3, 0)).toBe(2)
  })

  it('「改过来吧」= 回到刚才离开的下一版', () => {
    expect(resolveVersionRef('改过来吧', 3, 0)).toBe(1)
    expect(resolveVersionRef('刚才那版', 3, 1)).toBe(2)
  })

  it('上一版/下一版', () => {
    expect(resolveVersionRef('上一版', 3, 1)).toBe(0)
    expect(resolveVersionRef('下一版', 3, 1)).toBe(2)
    expect(resolveVersionRef('上一版', 3, 0)).toBeNull() // 已经在第一版
    expect(resolveVersionRef('下一版', 3, 2)).toBeNull() // 已经在最后
  })

  it('只有一版时任何指代都不触发', () => {
    expect(resolveVersionRef('改成第二版', 1, 0)).toBeNull()
  })

  it('越界指代不触发', () => {
    expect(resolveVersionRef('改成第九版', 3, 0)).toBeNull()
  })

  it('「改成蓝色」不是版本指代', () => {
    expect(resolveVersionRef('把主色改成蓝色', 3, 0)).toBeNull()
  })
})

describe('质问/不满里提到版本：不是切换指令', () => {
  // 用户实测原话："你这个第三版是什么东西，完全不是hello world了"
  // 系统曾经回"已切到第 3 版"——用户问东它答西
  it('质问语气 + 版本指代 → 不切换', () => {
    expect(resolveVersionRef('你这个第三版是什么东西，完全不是hello world了', 4, 2)).toBeNull()
    expect(resolveVersionRef('第二版完全不对', 2, 1)).toBeNull()
    expect(resolveVersionRef('第一版是什么玩意', 2, 0)).toBeNull()
    expect(resolveVersionRef('第二版跑偏了', 2, 1)).toBeNull()
  })

  it('有明确切换动词时，质问语气让位', () => {
    // "改回"是明确指令 —— 用户边骂边下命令，听命令
    expect(resolveVersionRef('第三版完全不对，改回第二版', 3, 2)).toBe(1)
    expect(resolveVersionRef('太丑了，还是回到第一版', 2, 1)).toBe(0)
  })

  it('正常切换指令不受影响', () => {
    expect(resolveVersionRef('改成第二版', 2, 0)).toBe(1)
    expect(resolveVersionRef('还是第一版', 2, 1)).toBe(0)
    expect(resolveVersionRef('把第二版那个区块删掉', 2, 0)).toBe(1)
  })

  it('isVersionComplaint 与 resolveVersionRef 判定一致', () => {
    expect(isVersionComplaint('你这个第三版是什么东西')).toBe(true)
    expect(isVersionComplaint('改成第二版')).toBe(false)
    expect(isVersionComplaint('第三版完全不对，改回第二版')).toBe(false)
  })
})

describe('isRebuild 推倒重做', () => {
  it('命中重做词', () => {
    expect(isRebuild('推倒重做，出一个全新的第三版')).toBe(true)
    expect(isRebuild('算了，重新做一版吧')).toBe(true)
    expect(isRebuild('从头做，从零开始')).toBe(true)
    expect(isRebuild('做一个全新的版本')).toBe(true)
  })

  it('普通修改不是重做', () => {
    expect(isRebuild('换个颜色吧，绿色')).toBe(false)
    expect(isRebuild('把标题改大一点')).toBe(false)
    expect(isRebuild('改成第二版')).toBe(false)
  })
})

describe('isDriftComplaint 结果偏离了最初需求', () => {
  it('命中偏离词', () => {
    expect(isDriftComplaint('完全不是hello world了')).toBe(true)
    expect(isDriftComplaint('这做的是什么玩意')).toBe(true)
    expect(isDriftComplaint('根本不是我要的')).toBe(true)
  })

  it('质量不满不算偏离（不该推倒重来）', () => {
    expect(isDriftComplaint('太丑了，换成暗色')).toBe(false)
    expect(isDriftComplaint('布局有点乱')).toBe(false)
    expect(isDriftComplaint('换个颜色吧')).toBe(false)
  })
})

describe('buildVersionSummary 版本历史摘要', () => {
  const versions = [
    { prompt: '写个最简单的hello world，其他啥也不要', plan: '- 创建一个极简的HTML页面\n- 中央显示Hello World' },
    { prompt: '换个颜色吧，绿色', plan: '- 主色改绿' },
  ]

  it('只有一版时给空串（不浪费路由 token）', () => {
    expect(buildVersionSummary([versions[0]], 0)).toBe('')
  })

  it('每版必须带【用户原话】——它是需求的 Ground Truth', () => {
    // 曾经只给 plan 第一行："创建一个极简的HTML页面"——
    // 用户真正说的"hello world"路由器根本没看见，
    // "推倒重做"时直接把最初需求丢了（实测踩坑）
    const s = buildVersionSummary(versions, 1)
    expect(s).toContain('共 2 版')
    expect(s).toContain('当前停在第 2 版')
    expect(s).toContain('第 1 版：用户说「写个最简单的hello world，其他啥也不要」')
    expect(s).toContain('→ 做成「创建一个极简的HTML页面」')
    expect(s).toContain('第 2 版：用户说「换个颜色吧，绿色」')
    expect(s).toContain('← 当前')
    expect(s).toContain('推倒重做')
  })
})
