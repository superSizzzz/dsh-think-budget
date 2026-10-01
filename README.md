# dsh-think-budget

[English](README.en.md) | 中文

dsh 干活时会闷头想很久，屏幕上半天不出现一个字 —— 你分不清它是在推进还是卡死了。
这个插件给它一个节拍：单步思考有字数预算，连续几步没写出正文就提醒它一句。

## 装它

```powershell
dsh plugin --profile web add github:superSizzzz/dsh-think-budget
```

一条命令，装完即生效 —— dsh 会读包里的 `dsh.bundle.patch` 自动并入 profile。

```powershell
dsh plugin --profile web remove dsh-think-budget    # 卸载
```

| 项 | 要求 |
|---|---|
| dsh | ≥ 0.1.7-rc.2 |
| Node | ≥ 22.6 |
| profile | 不限 —— web / tui / headless 都能装 |
| 模型 | 不限 —— 只有会产出思考过程的路由才会触发「思考超预算」那条规则 |

换 `--profile` 后面的名字就能装到别的 profile，每个 profile 各装一次。
想改源码、让改动立刻热重载，见[开发与测试](docs/development.md)。

## 它怎么管

两个触发条件，满足任一就出手：

- **连着几步没写正文** —— 默认 3 步。「正文」指对话里看得见的那部分，思考过程不算：
  你看不见的东西不算交付。
- **单步思考太长** —— 默认 4000 字，且这一步同样没写正文。

做法分两层：平时往系统提示里写一段节拍规则让模型自己配合，越界时直接往会话里注入
一条提醒。模型收到的就是这段：

```text
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

文案故意留了退路：「还不确定」也算结论。只逼「必须说点什么」、不逼「必须想明白」——
否则模型为了凑数会编一个假答案，那是这类插件最容易帮倒忙的地方。

## 用起来是什么样

下面两行是插件自己记的账，来自真实对话（会话 id 已省略）。

第一条：模型连续 3 步只思考和调工具、正文 0 字，插件随即要求它先给结论。

```json
{"at":"2026-09-26T09:15:30.056Z","kind":"no-conclusion-streak","streak":3,"reasoningChars":1840,"visibleChars":0,"toolCalls":2}
```

第二条：同一场对话稍后，单步思考到 4432 字、依然没写正文。

```json
{"at":"2026-09-26T09:43:38.767Z","kind":"reasoning-over-budget","streak":1,"reasoningChars":4432,"visibleChars":0,"toolCalls":2}
```

两次都当场见效：模型的下一条回复就带上了正文。

## 调它

配置写在装它的那段 patch 里 —— 没有独立配置文件，也没有设置界面。要改松紧，往
`~/.dsh/profiles/web/cordis.patch.yml` 末尾追加一段（只写要改的字段）：

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 5      # 连续几步没正文才提醒，默认 3
    maxReasoningCharsPerStep: 8000    # 单步思考字数预算，默认 4000
```

保存即热重载，不用重启 dsh。字段填错会在重载时报清晰的错误，不会静默退回默认值。

想更严：`maxStepsWithoutConclusion: 2`、`maxReasoningCharsPerStep: 2500`。
全部字段见[配置速查](#配置速查)。

### 怎么确认它真的在管事

给配置加一行日志路径：

```yaml
- id: think-budget
  config:
    logPath: 'D:/logs/think-budget.jsonl'
```

那个文件随即出现一行 `{"event":"applied",…}`（里面是这次实际生效的配置）—— 有它
就说明插件装上了。之后每次出手还会追加一行。

一行都没有 = 插件没被加载，回头检查装它的命令有没有成功。

## 它不碰什么

| | |
|---|---|
| 网络 | 不发任何请求 |
| 命令 | 不执行任何命令 |
| 工具 | 不加新工具、不改你的工具列表 |
| 你的消息 | 不改写、不删除 |
| 会话 | 只往里加消息；不取消轮次、不拦截步骤 |
| 磁盘 | 唯一会碰的是 `logPath` 那个日志文件，默认关闭 |

完整的权限说明与已知限制见[工作原理](docs/how-it-works.md)。

## 卸载

```powershell
dsh plugin --profile web remove dsh-think-budget
```

源码方式装的，删掉补丁文件里那段 `- insert:` 即可。插件不写任何持久状态，删掉就是删掉。

## 常见问题

**装完没动静？** 正常 —— 只有模型真的越界时它才出声。想看它有没有在运行，按上面
「怎么确认它真的在管事」加一行 `logPath`。

**会不会拖慢会话？** 不会。它只是在流经过时数一下字数，不额外调用模型、不阻塞。

**能和其他插件共存吗？** 能。用的都是 dsh 的公开扩展点，跟你现有的插件互不干扰。

## 配置速查

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。false 时一个监听器都不装 |
| `maxReasoningCharsPerStep` | `4000` | 单步思考字符预算；只在「这一步没写正文」时算数。`0` 关掉这一项 |
| `maxStepsWithoutConclusion` | `3` | 连续多少步没写正文就强制要一条。`0` 关掉这一项 |
| `minConclusionChars` | `12` | 去空白后多长算「结论」。挡住「让我看看」这类过渡语 |
| `cooldownSteps` | `2` | 同一种提醒两次之间的最小步数间隔 |
| `maxRemindersPerTurn` | `5` | 单轮提醒条数上限；到顶就闭嘴等下一条用户消息 |
| `includeSubagents` | `true` | 是否也管子 agent。false 时只盯顶层 agent |
| `systemPromptSection` | `true` | 是否注册系统提示里的「思考节拍」段落 |
| `downgradeReasoningEffort` | `''` | 越界时的推理强度降档值。空 = 不用（**推荐保持空**） |
| `reminderTag` | `思考节拍` | 提醒文案里方括号里的标签 |
| `logPath` | `''` | 事件日志（JSONL）。空 = 不记 |

## 想深入

- [工作原理](docs/how-it-works.md) —— 判定细节、用到的 dsh 事件面、实现地图、已知限制
- [开发与测试](docs/development.md) —— 源码加载 vs 编译产物、构建、三个测试
- [排查](docs/troubleshooting.md) —— 日志字段、调阈值、装了两份怎么办

也可以直接对 AI agent 说一句：「照 https://github.com/superSizzzz/dsh-think-budget
的 README 帮我装上」，它读得懂。

## 许可

MIT，见 [LICENSE](./LICENSE)。
