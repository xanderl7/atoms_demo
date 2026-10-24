# LIU XU's Atoms Demo

> 一句话描述你想要的应用，AI 生成可直接运行的单文件网页原型 —— 生成完还会自检，有 bug 自己修。

对标 [atoms.dev](https://atoms.dev/) 的核心交互：对话即开发。你说需求，它出页面；你提修改，它改页面。**纯前端实现，零后端**：浏览器直连大模型，Key 只存在你自己的 localStorage 里。

```bash
npm install
npm run dev        # 打开 http://localhost:5173 ，点右上角 ⚙︎ 填 API Key 就能用
```

---

## 功能特性

| 能力 | 说明 |
|---|---|
| 一句话生成页面 | 流式输出、可中断、实时显示已生成字符数 |
| 七态意图路由 | 聊天 / 澄清 / 生成 / 局部修改 / 质疑追问 / 交接引导 / 拒绝 —— 不是所有输入都该生成代码 |
| 三级降级局部编辑 | 改颜色这类小改动：本地规则 0 次 LLM → 定位+补丁只传相关区块 → 才整篇重写 |
| **生成后自检 + 自动修复** | 每次出新版本自动跑：静态检查 → iframe 真实运行时错误 → 回喂模型修，最多 2 轮，修不完如实告知 |
| 版本历史 | 多轮迭代=追加版本，「改回第二版」直接切历史，不重新生成 |
| 明确的产品边界 | 搭后端/真实支付/小程序这类请求**直接拒绝**，绝不做"长得像的假货"糊弄 |
| 不收文件，不编内容 | 没有上传入口 → 告诉用户自己改哪几处；用户没给的内容一律占位标记，绝不编看起来很真的假数据 |
| 边界声明 | 生成完扫代码，明说"我做了什么 / 用什么顶位了 / 你后续怎么改" |
| 预览区沙箱 | iframe `srcDoc` 沙箱渲染；JS 运行时错误、脚本语法错误实时捕获；原生 alert 换成页面内提示条 |

## 快速开始

```bash
# 1. 安装依赖（Node 20+）
npm install

# 2. 启动开发服务器
npm run dev

# 3. 打开 http://localhost:5173 ，点右上角 ⚙︎ 填写智谱开放平台的 API Key
#    Key 只写入浏览器 localStorage，不上传任何服务器
```

### 模型配置

默认走智谱 GLM（`glm-4.5-air`，非推理模型，生成快 3-4 倍）。设置弹窗里可以改：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| API Key | 空 | 智谱开放平台申请，只存浏览器本地 |
| Base URL | `/zhipu` | 走 Vite 开发代理绕开浏览器跨域（见下文「跨域」） |
| 模型 | `glm-4.5-air` | 任何 OpenAI 兼容接口都能接，改 Base URL + Key + 模型名即可 |
| 思维链 | 关闭 | glm-5.x 强制思考会报 1210，代码里已做自动降级重试 |

### 环境变量（仅测试用）

| 变量 | 用途 |
|---|---|
| `ZHIPU_API_KEY` | e2e 测试用的 Key（`npm run test:e2e` 必须） |
| `APP_URL` | e2e 打的应用地址，默认 `http://localhost:5173` |
| `ZHIPU_PROXY_TARGET` | 覆盖代理目标，默认 `https://open.bigmodel.cn`（换其他 OpenAI 兼容服务时用） |

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（5173） |
| `npm run build` | 类型检查 + 生产构建（产物在 `dist/`） |
| `npm run preview` | 预览生产构建（4173） |
| `npm run typecheck` | TypeScript strict 分层检查（app / node 两份配置） |
| `npm run lint` | ESLint（typescript-eslint + react-hooks + react-refresh） |
| `npm test` | Vitest 单元测试（65 项，覆盖纯逻辑：路由解析/补丁/拒绝规则/自检/探针） |
| `npm run test:e2e` | Playwright 端到端全量（需 Key + dev server 在跑） |
| `npm run verify` | 一键全跑：typecheck → lint → test → build |
| `npm run watchdog` | 看门狗守护进程：每分钟自查 agent 响应与 dev server 存活 |

## 项目结构

```
atoms-demo/
├── src/
│   ├── App.tsx            主编排：handleSend 全流程（路由→澄清→生成→自检 arm）
│   ├── prompts.ts         所有 LLM 提示词 + 路由 JSON 三层容错解析（调效果只改这里）
│   ├── llm.ts             OpenAI 兼容客户端：流式/中断/5xx 重试/1210 自动降级
│   ├── useAutoFix.ts      自检+自动修复闭环（hook）
│   ├── verify.ts          静态自检：script 配对/HTML 解析/重复 id/空页面/form action/TODO
│   ├── patcher.ts         局部编辑：切区块/补丁执行/本地规则快改
│   ├── iframeProbe.ts     iframe 错误捕获桥 + 假弹框消除（探针源码 + 主应用监听）
│   ├── refuse.ts          页面之外的请求：本地规则直接拒绝
│   ├── unsupported.ts     收不到文件的请求：引导用户自己改，绝不编造
│   ├── limits.ts          边界声明：扫代码生成"我做了什么/没做什么/你怎么改"
│   ├── logger.ts          日志系统（右上角「日志」可看全程）
│   ├── config.ts          LLM 配置存取（localStorage）
│   ├── types.ts           核心数据结构
│   └── components/        ChatPanel / PreviewPane / CodePane / Settings / LogPanel
├── src/__tests__/         单元测试（9 个文件 82 项）
├── e2e/                   Playwright 端到端（19 个脚本 + run-all runner）
├── scripts/watchdog.mjs   看门狗：每分钟检查 agent 心跳与 dev server
├── vite.config.ts         Vite 配置 + /zhipu 跨域代理
└── vitest.config.ts       单测配置（node 环境 + happy-dom 按需注入）
```

## 核心设计

### 1. 七态意图路由

用户每句话先过一道路由（一次轻量 LLM 调用），**不是所有输入都该生成代码**：

| 意图 | 触发场景 | 行为 |
|---|---|---|
| `chat` | 问候、闲聊、问你是谁 | 只回文字 |
| `clarify` | 需求太模糊（"做个作品集"） | 先问最关键的问题，给可点选项；最多 3 轮 |
| `build` | 需求明确 | 拆解 → 生成 |
| `patch` | 对已有页面做 1-3 处明确微调 | 走局部编辑（见下） |
| `probe` | 用户质疑上一版（"不对""太丑了"） | 不道歉，把"哪里不对"抛回去问 |
| `handoff` | 要用用户上传的真实素材 | 引导他自己改哪几处，不编造 |
| `refuse` | 搭后端/真实支付/小程序等页面外的请求 | 明确拒绝 + 为什么 + 出路 |

关键铁律：**plan 里出现反问就必须停下来问**，绝不"一边问一边生成"；个人介绍页第一轮就必须问"这是谁的页面"。

### 2. 三级降级局部编辑

小改动不该重传整页代码（上下文会爆）。按成本从低到试：

1. **本地规则**（0 次 LLM）：改主色/删区块/改标题 —— 正则直接改，毫秒级
2. **定位 + 补丁**（2 次小请求）：先只传区块目录让模型挑要改哪几块，再把这几块正文给它，它只回一小段 JSON 补丁，前端拼回原页面
3. **整篇重写**（兜底）：上面任何一步校验不过就降级，保证用户永远拿到结果

上下文预算 `CONTEXT_BUDGET = 24000` 字符：超了先压缩（去注释空行），还超只传结构骨架。

### 3. 生成后自检 + 自动修复闭环

```
生成/修改完新版本
   │
   ├─ 静态检查（0 请求）：script 开合配对 / HTML 可解析 / 重复 id /
   │   空页面 / form action / TODO 占位
   │
   ├─ 等 iframe 加载完 1.6s，收集探针报的真实运行时错误
   │   （JS 异常、Promise 未捕获、script 语法错误全抓；
   │     图片加载失败这类资源错误 deliberately 不报 —— 那是假报错）
   │
   ├─ 没问题 → 「✅ 自检通过」
   │
   └─ 有问题 → 带着【完整代码 + 问题清单】回喂模型修
               （SYSTEM_FIX：只修错误，不许顺手重构）
                 │
                 ├─ 修完重新自检，最多 2 轮
                 └─ 2 轮还修不完 → 明确告诉用户还剩哪几个问题，不无限循环烧钱
```

### 4. 沙箱与安全边界

- iframe 用 `srcDoc` + `sandbox="allow-scripts allow-forms allow-popups"`（**没有** `allow-same-origin`）渲染生成的页面，模型代码碰不到主应用的 DOM/Storage
- 沙箱里没有 `allow-modals`：生成的页面调 `alert()` 不会弹原生框（以前会弹空白对话框），探针把 alert/confirm/prompt 换成页面内 toast
- 生成的页面一碰 localStorage 会抛错 → 先注入内存版假实现兜底
- API Key 只存浏览器 localStorage，不过任何服务器

### 5. 跨域为什么走代理

智谱接口会回 `ACAO` 头，但 preflight（OPTIONS）不回；浏览器带 `Authorization` 头必然先发 OPTIONS → 大概率被拦。所以 dev server 挂一条 `/zhipu` 代理转发到 `https://open.bigmodel.cn/api/paas/v4`，一劳永逸，换后端只改 target。

## 测试

```bash
npm test              # 单元测试：82 项 / 9 文件
npm run test:e2e      # 端到端：19 个 Playwright 脚本，顺序跑完出汇总
npm run verify        # typecheck + lint + test + build 一键全跑
```

单测覆盖的是**确定性的纯逻辑**（不花 Key、不依赖网络）：路由 JSON 三层容错、补丁执行与校验、拒绝/引导规则、静态自检、探针错误分类。e2e 覆盖**真实链路**：生成、澄清、局部修改、回退、版本指代、拒绝、交接引导、报错条、自检闭环。

## 已知边界（诚实清单）

这个工具**只生成网页界面原型**，以下事情明确不做，也绝不用"长得像的假货"糊弄：

- ❌ 搭后端、写接口、数据库、部署上线（没有运行环境）
- ❌ 真实的登录/支付/短信/地图/文件上传（拿不到真凭据）
- ❌ 小程序 / APP / 桌面软件 / 浏览器插件 / CLI（不是网页）
- ❌ 接收用户上传的文件（没有上传入口 → 引导用户自己改代码里的占位处）
- ⚠️ 自动修复最多 2 轮，修不完会如实告知剩余问题
- ⚠️ API Key 存在浏览器本地，换浏览器/清缓存要重新填

## 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 架构 | 纯前端直连 LLM | 零部署成本；Key 不出用户浏览器；演示即全部 |
| 框架 | Vite 6 + React 18 + TS（strict） | 成熟生态；strict + 分层 tsconfig 保证质量 |
| 模型协议 | OpenAI 兼容 `/chat/completions` | 换任何厂商只改 Base URL + Key + 模型名 |
| 生成粒度 | 单文件自包含 HTML | 下载即可用；无构建步骤；沙箱隔离成本最低 |
| 预览 | iframe `srcDoc` + sandbox | 模型代码与主应用强隔离 |
| 测试 | Vitest（纯逻辑）+ Playwright（真实链路） | 快的快跑，慢的 nightly |
