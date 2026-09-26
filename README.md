# dsh-think-budget —— 思考节拍器

[English](README.en.md) | 中文

管住 dsh「闷头想很久、屏幕上一直不出现正文」这件事：给单步思考一个字数
预算，并且要求它在若干步之内必须写出一条可见结论，然后才能继续。

插件本身没有任何新工具、新服务、新 UI。它只做两件事：往系统提示里写一段
规则，以及在模型越界时往会话里塞一条提醒。

## 它管的是什么

观察到的现象：一次提问之后，模型连着跑了十来步 —— 每一步都在思考、都在调
工具 —— 但对话里一个字都没多出来。用户看不出它是在推进还是卡住了。

判据只有一条，都在明面上：

- **一次「回复」= 一步** = 一次成功的模型调用（一个提交进会话的
  `assistant/message`）。失败的尝试、被取消的流不算。
- **「结论」= 这一步的可见正文**，去掉空白后长度 ≥ `minConclusionChars`。
  思考（reasoning）不算 —— 用户看不见它，它就不是交付物。
- 连续 `maxStepsWithoutConclusion` 步没有结论，或者单步思考超过
  `maxReasoningCharsPerStep` 字且这一步没结论，就出手。

## 两层机制

**预防层** —— 往系统提示注册一段「思考节拍」：

```markdown
## 思考节拍

- 思考（reasoning）是内部草稿，用户看不到；正文才是交付物。不要把结论留在思考里。
- 每 3 次回复之内，至少写一次可见正文结论 —— 阶段判断也算，「目前还不确定，因为…」也算。
- 单次思考控制在约 4000 字以内。一件事推演到能下判断就够了，不要反复重推同一个问题。
- 先给结论，再继续调用工具；需要长任务时，用阶段结论代替沉默。
```

模型一开始就配合，比事后纠正省事得多。关掉它（`systemPromptSection: false`）
就只剩补救层。

**补救层** —— 越界时注入一条模型可见的提醒：

```
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

这条消息走 `agent.inject()`，是一等公民的 user 消息：有 id、有自己的来源
kind（`think-budget`）、会进会话日志、在 UI 里有折叠摘要。它不是注释、不是
旁路 —— 模型像读任何一条用户消息那样读它。

文案刻意给退路：「还不确定」也算结论。只逼「必须写点什么」、不逼「必须想
明白」，否则模型为了凑结论会编一个假答案 —— 那是这类插件最容易帮倒忙的
地方。

## 能力边界

**它拦不住正在生成的思考流。**

reasoning 由模型端产出、经由流式协议送达 harness。harness 收的时候那些
token 已经产生了。所以「限制思考长度」在这里的落地方式是：

- 越界 → 下一轮施压（提醒注入）；
- 可选硬手段：越界 → 该步请求换一个更低的推理强度
  （`downgradeReasoningEffort`，**默认关闭**）。

「到点掐断正在生成的思考」这件事，插件层做不到。唯一真正的硬开关是推理
强度，而它是按请求设置的，只能在每一步开始前决定。

另外三点也如实说：

- **不取消轮次、不拒绝步骤、不改消息内容。** 插件只往会话里加消息。想强
  制停止失控轮次是另一个插件的活（`agent/turn-stopping` 那条路）。
- **恢复的会话从零开始计数。** 账本只在内存里，是从流里现数的。恢复一个
  压缩过的会话不会把历史 reasoning 重算一遍。
- **降档是唯一有副作用的开关。** 填了模型不支持的档位，会让这次请求以
  `UNSUPPORTED_REASONING_EFFORT` 失败。所以默认关，且只在连续无结论到
  阈值（模型明显陷进去了）时才用。

## 装上

插件不自己装依赖 —— `@deepseek-ai/*` 由 dsh 提供，这里只声明
peerDependencies。所以 clone 之后要把依赖接过去，再挂进 dsh 的补丁层。

```powershell
# 1) 放到你想放的位置
git clone https://github.com/superSizzzz/dsh-think-budget.git D:\plugins\dsh-think-budget

# 2) 接依赖（在插件目录下建一个指向 dsh 依赖目录的 junction）
cd D:\plugins\dsh-think-budget
node scripts/link-deps.mjs

# 3) 挂载 —— 见下面的 patch 段
```

```yaml
# 粘进 profile 的补丁文件。name 的路径换成你的实际位置。
- insert:
    - id: think-budget
      name: 'file:///D:/plugins/dsh-think-budget/src/index.ts'
      config:
        enabled: true
        maxReasoningCharsPerStep: 4000
        maxStepsWithoutConclusion: 3
```

粘到哪个文件，决定管多大范围：

| 文件 | 作用范围 |
|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` | 只管 web profile |
| `~/.dsh/cordis.patch.yml` | home 层，对所有 profile 生效 |

dsh 的 profile 默认开着 `patchReload: live`，改完即热重载，不用重启 dsh。

想先试一次、不碰任何 profile 文件，仓库里备了一份现成的补丁层：

```powershell
dsh web --patch D:\plugins\dsh-think-budget\cordis.think-budget.yml
```

（里面的路径同样要改成你的实际位置。）

## 卸掉

从 `cordis.patch.yml` 删掉那个 `insert` 块（或把 `enabled` 改成 `false`
保留代码但停手）。插件没写任何持久状态，删掉就是删掉。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。false 时一个监听器都不装 |
| `maxReasoningCharsPerStep` | `4000` | 单步思考字符预算；只在「这一步没结论」时算数。`0` 关掉这一项 |
| `maxStepsWithoutConclusion` | `3` | 连续多少步没结论就强制要一条。`0` 关掉这一项 |
| `minConclusionChars` | `12` | 去空白后多长算「结论」。挡住「让我看看」这类过渡语 |
| `cooldownSteps` | `2` | 同一种提醒两次之间的最小步数间隔 |
| `maxRemindersPerTurn` | `5` | 单轮提醒条数上限；到顶就闭嘴等下一条用户消息 |
| `includeSubagents` | `true` | 是否也管子 agent。false 时只盯顶层 agent |
| `systemPromptSection` | `true` | 是否注册系统提示里的「思考节拍」段落 |
| `downgradeReasoningEffort` | `''` | 越界时的推理强度降档值。空 = 不用（**推荐保持空**） |
| `reminderTag` | `思考节拍` | 提醒文案里方括号里的标签 |
| `logPath` | `''` | 事件日志（JSONL）。空 = 不记 |

想更严：`maxStepsWithoutConclusion: 2`、`maxReasoningCharsPerStep: 2500`。
想更松：`maxStepsWithoutConclusion: 5`、`maxReasoningCharsPerStep: 8000`。

## 开发

零构建：dsh 直接加载 `src/index.ts`，靠 Node 的 TypeScript 类型擦除（需要
Node ≥ 22.6）。改完保存，profile 的 `patchReload: live` 就会热重载 —— 不用
编译、不用重启 dsh。

```powershell
node scripts/link-deps.mjs   # 首次 clone 后接一次依赖
npm test                     # 跑两个测试文件
```

因为加载方式依赖类型擦除，源码里要避开需要转译的语法（`enum`、参数属性、
装饰器），相对导入要带 `.ts` 扩展名。

## 测试

两个测试都是直跑，不需要起 dsh、不花额度：

```powershell
npm test                            # 两个一起跑
node test/tracker.test.mjs          # 判定规则的 43 项断言
node test/plugin.smoke.mjs          # 装配与注入链路的 34 项断言
```

`tracker.test.mjs` 钉的是智力：什么算结论、什么时候出声、冷却和配额怎么算、
新一轮怎么清账、关掉的项真的不触发。

`plugin.smoke.mjs` 钉的是接线：`apply` 不抛错、事件名注册得上、流里的字数
被正确累计、越界时真的调了 `agent.inject()`、注入的是一份 harness 收得下
的完整 user 消息。用的是假 ctx 和假 agent。

想再验一层「dsh 的 loader 到底认不认它」，起一个不占 3080 的隔离实例：

```powershell
dsh --profile web --patch <插件目录>\test\verify-load.yml --port 3199 --no-open
```

`verify-load.yml` 会先把飞书桥关掉（验证过程不该往真实飞书发消息），再把
装载留痕写进 `test/.verify-applied.jsonl`。文件里出现带 `"event":"applied"`
的行，就说明 loader 解析了 file:// 路径、import 了 `.ts`、校过 config、
调到了 `apply`。验证完把那个实例关掉即可。

## 排查

在配置里打开 `logPath`，每次注入提醒会追加一行 JSONL：

```json
{"at":"2026-01-01T00:00:00.000Z","sessionId":"main-session-...","kind":"no-conclusion-streak","streak":3,"reasoningChars":1284,"visibleChars":0,"toolCalls":2}
```

有行 = 插件在管事、模型确实越界了。一行都没有 = 模型这段时间表现没问题，
或者阈值太松（调小 `maxStepsWithoutConclusion` 试试）。

## 实现地图

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：装配监听器、累计流、投递提醒、注册系统提示 |
| `src/tracker.ts` | 账本与判定规则。纯逻辑，不碰任何服务 |
| `src/policy.ts` | 所有对模型说的话（系统提示段落、提醒正文、摘要） |
| `src/config.ts` | schemastery 配置 schema 与归一化 |
| `scripts/link-deps.mjs` | 把 `node_modules` 链到 dsh 的依赖目录 |
| `cordis.think-budget.yml` | 现成的补丁层，`--patch` 直接用 |
| `test/tracker.test.mjs` | 判定规则测试 |
| `test/plugin.smoke.mjs` | 装配链路测试 |
| `test/verify-load.yml` | 隔离实例验证用的补丁层 |

## 它依赖的 harness 接口

全部来自 dsh 0.1.7-rc.2 的公开事件面，没有碰包内实现：

| 接口 | 用途 |
|---|---|
| `agent/assistant-stream` | 逐片读流的 `text-delta` / `reasoning-delta`，累积出「这一步思考多长、写了多少正文」 |
| `agent.inject(UserMessage)` | 把提醒投进模型看得见的地方 |
| `agent/request` waterfall | 可选：改写这一步的 `reasoningEffort` |
| `systemPrompt.section()` | 注册「思考节拍」系统提示段落 |
| `createUserMessage()` / `MessageSourceMap` | 造一条合法消息，并声明自己的来源 kind |

## 许可

MIT，见 [LICENSE](./LICENSE)。
