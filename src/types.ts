// 核心数据结构：Step 1 定下来，后面所有功能都长在这上面

export type Role = 'user' | 'assistant'

/** 一次生成过程中的可见步骤，用于左栏「思考中」展示 */
export type StepStatus = 'pending' | 'running' | 'done' | 'error'
export interface Step {
  id: string
  label: string
  status: StepStatus
}

/** 对话消息。assistant 消息可以携带步骤流 */
export interface Message {
  id: string
  role: Role
  content: string
  steps?: Step[]
}

/** 一个「应用版本」：一次生成的结果快照。多轮迭代 = 追加版本 */
export interface AppVersion {
  id: string
  prompt: string      // 产生这个版本的用户指令
  plan?: string       // Step 4 之后填入需求拆解
  code: string        // 自包含 HTML
  createdAt: number
}
