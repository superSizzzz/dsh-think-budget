# 工作原理

[← 回 README](../README.md)

这一页给想知道「它到底怎么判断、怎么出手」的人。用法看 README，这里讲机制。

## 判定的精确定义

**一步** = 一次成功的模型调用，也就是会话里提交了一个 `assistant/message`。失败的
尝试、被取消的流不算 —— 模型没说完的话不该记在它账上。

**结论** = 这一步的可见正文，去掉空白后长度 ≥ `minConclusionChars`（默认 12）。思考
（reasoning）不算：用户看不见它，它就不是交付物。

**出手条件**（满足任一）：

| 条件 | 默认阈值 | 看的是 |
|---|---|---|
| 连续 N 步没有结论 | `maxStepsWithoutConclusion: 3` | 步与步之间的连续性 |
| 单步思考超 N 字**且**这一步没结论 | `maxReasoningCharsPerStep: 4000` | 单个步骤内的量 |

第二条要求「且没结论」是刻意的：思考长但写了结论的步骤不打扰。用户要的是「别一直
不吭声」，不是「思考必须短」。

判定逻辑集中在 `src/tracker.ts`，是一个纯函数式的账本，不依赖任何服务 —— 这也是它
能被单独测出 43 项断言的原因。想改判定规则，从那里下手。

## 两级动作

**预防层** —— 往系统提示注册一段「思考节拍」，模型一开始就配合：

```markdown
## 思考节拍

- 思考（reasoning）是内部草稿，用户看不到；正文才是交付物。不要把结论留在思考里。
- 每 3 次回复之内，至少写一次可见正文结论 —— 阶段判断也算，「目前还不确定，因为…」也算。
- 单次思考控制在约 4000 字以内。一件事推演到能下判断就够了，不要反复重推同一个问题。
- 先给结论，再继续调用工具；需要长任务时，用阶段结论代替沉默。
```

段落里的数字跟着 `maxStepsWithoutConclusion` / `maxReasoningCharsPerStep` 走。关掉它
（`systemPromptSection: false`）就只剩补救层。

**补救层** —— 越界时注入一条模型可见的提醒。这条消息走 `agent.inject()`，是一等公民
的 user 消息：有 id、有自己的来源 kind（`think-budget`）、会进会话日志、在 UI 里有折叠
摘要。它不是注释、不是旁路 —— 模型像读任何一条用户消息那样读它。

## 它到底能管到什么程度

**它拦不住正在生成的思考流。**

reasoning 由模型端产出、经由流式协议送达 harness。harness 收的时候那些 token 已经
产生了。所以「限制思考长度」在这里的落地方式是：

- 越界 → 下一步施压（提醒注入）；
- 可选硬手段：越界 → 该步请求换一个更低的推理强度（`downgradeReasoningEffort`，
  **默认关闭**）。

「到点掐断正在生成的思考」需要有流级的中断能力，那是另一条路。唯一真正的硬开关是推理
强度，而它是按请求设置的，只能在每一步开始前决定。

其余三条如实说：

- **不取消轮次、不拒绝步骤、不改消息内容。** 插件只往会话里加消息。想强制停止失控轮次
  是另一个插件的活（`agent/turn-stopping` 那条路）。
- **恢复的会话从零开始计数。** 账本只在内存里，是从流里现数的。恢复一个压缩过的会话
  不会把历史 reasoning 重算一遍。
- **降档是唯一有副作用的开关。** 填了模型不支持的档位，会让这次请求以
  `UNSUPPORTED_REASONING_EFFORT` 失败。所以默认关，且只在连续无结论到阈值（模型明显
  陷进去了）时才用。

## 它要什么权限

| 动作 | 具体是什么 | 怎么关 |
|---|---|---|
| 读 | 数流里的分片长度（`agent/assistant-stream` 的 text / reasoning delta） | `enabled: false` |
| 写 | 往会话注入一条 user 消息（`agent.inject`） | `enabled: false` |
| 改 | 注册一段系统提示（`systemPrompt.section`） | `systemPromptSection: false` |
| 改 | 改写单步请求的推理强度（`agent/request` waterfall） | 默认就关（`downgradeReasoningEffort` 留空） |
| 文件 | 往 `logPath` 追加一行 JSONL | 默认就关（`logPath` 留空） |

没有网络请求，不执行命令，不加新工具。会碰磁盘的只有 `logPath` 那一项。

## 它用到的 dsh 接口

全部来自 dsh 0.1.7-rc.2 的公开事件面，没有碰包内实现：

| 接口 | 用途 |
|---|---|
| `agent/assistant-stream` | 逐片读流的 `text-delta` / `reasoning-delta`，累积出「这一步思考多长、写了多少正文」 |
| `agent.inject(UserMessage)` | 把提醒投进模型看得见的地方 |
| `agent/request` waterfall | 可选：改写这一步的 `reasoningEffort` |
| `systemPrompt.section()` | 注册「思考节拍」系统提示段落 |
| `createUserMessage()` / `MessageSourceMap` | 造一条合法消息，并声明自己的来源 kind |

## 实现地图

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：装配监听器、累计流、投递提醒、注册系统提示 |
| `src/tracker.ts` | 账本与判定规则。纯逻辑，不碰任何服务 |
| `src/policy.ts` | 所有对模型说的话（系统提示段落、提醒正文、摘要） |
| `src/config.ts` | schemastery 配置 schema 与归一化 |
| `lib/` | 编译产物，`dsh plugin add` 装的就是它 |
| `scripts/link-deps.mjs` | 源码方式下把 `node_modules` 链到 dsh 的依赖目录 |
| `cordis.patch.yml` | 包自带的补丁层，`dsh plugin add` 装完自动应用 |
| `cordis.think-budget.yml` | 本地 checkout 用的补丁层，`--patch` 直接用 |
| `tsconfig.json` | 编译配置：`src/*.ts` → `lib/*.js` |
| `test/tracker.test.mjs` | 判定规则测试（43 项断言） |
| `test/plugin.smoke.mjs` | 装配链路测试（34 项断言） |
| `test/verify-load.yml` | 隔离实例验证用的补丁层 |
