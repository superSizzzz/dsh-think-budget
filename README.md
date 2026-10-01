# dsh-think-budget

[English](README.en.md) | 中文

dsh 想得久的时候，屏幕上会半天不出一个字，你在旁边看着也不知道它是在
推进还是卡住了。

这个插件给它加了个节拍：单步思考有字数上限，连着几步没写正文就提醒一句。

## 安装

```powershell
dsh plugin --profile web add github:superSizzzz/dsh-think-budget
```

一条命令就装好了。dsh 会读包里的 `dsh.bundle.patch` 自动并入当前 profile，
不用你手写配置。

不想要了：

```powershell
dsh plugin --profile web remove dsh-think-budget
```

| 项 | 要求 |
|---|---|
| dsh | ≥ 0.1.7-rc.2 |
| Node | ≥ 22.6 |
| profile | 不限，web / tui / headless 都能装 |
| 模型 | 不限。只有会产出思考过程的路由才会触发「思考超预算」那条规则 |

要装到别的 profile，把 `--profile` 后面的名字换掉，每个 profile 各装一次。

如果你是想改代码，走源码方式更方便，见[开发与测试](docs/development.md)。

## 插件能力

它管两件事，满足任意一条就会出手。

一是连着几步没写正文，默认 3 步。这里的「正文」指你在对话里看得见的那部分，
模型的思考过程不算：你看不见的东西，对你来说就等于没发生。

二是单步思考太长，默认 4000 字。这条还要求那一步同样没写正文。要是思考得久
但把结论说出来了，它不会去打扰。

做法分两层。平时它往系统提示里写一段节拍规则，让模型自己注意着点；真越界了
就往会话里塞一条提醒。模型收到的是这么一段：

```text
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

提醒里那句「还不确定也算结论」是有意留的口子。它只要求模型说点什么，不要求
它想明白，不然模型为了凑数会编个假答案出来，那反而更糟。

## 使用

装完不用做任何事，它自己就跑起来了。也不会拖慢会话，只是在流经过时数一下
字数，不额外调用模型。

平时它是安静的，只有模型真的越界才出声。下面两条是真实跑出来的记录
（会话 id 省略了）：

```json
{"at":"2026-09-26T09:15:30.056Z","kind":"no-conclusion-streak","streak":3,"reasoningChars":1840,"visibleChars":0,"toolCalls":2}
```

```json
{"at":"2026-09-26T09:43:38.767Z","kind":"reasoning-over-budget","streak":1,"reasoningChars":4432,"visibleChars":0,"toolCalls":2}
```

第一条是连着 3 步只思考和调工具、正文一个字没有，它要求模型先给结论。第二条
是同一场对话后面，单步思考到 4432 字还是没写正文。

两次都当场见效，模型下一条回复就带了正文。

## 配置思考步数

配置就写在装它的那段 patch 里。没有单独的配置文件，也没有设置界面。

想调松紧，往 `~/.dsh/profiles/web/cordis.patch.yml` 末尾加一段，只写你要改的
字段就行：

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 5      # 连着几步没正文才提醒，默认 3
    maxReasoningCharsPerStep: 8000    # 单步思考字数上限，默认 4000
```

保存就生效，不用重启 dsh。字段填错了重载时会直接报错，不会悄悄退回默认值。

想更严就 `maxStepsWithoutConclusion: 2`、`maxReasoningCharsPerStep: 2500`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。false 时一个监听器都不装 |
| `maxReasoningCharsPerStep` | `4000` | 单步思考字数上限，只在没写正文时才算数。`0` 关掉这一条 |
| `maxStepsWithoutConclusion` | `3` | 连着多少步没写正文就要一条。`0` 关掉这一条 |
| `minConclusionChars` | `12` | 去空白后多长算「正文」，用来挡住「让我看看」这种过渡语 |
| `cooldownSteps` | `2` | 同一种提醒两次之间至少隔几步 |
| `maxRemindersPerTurn` | `5` | 一轮最多提醒几条，到顶就安静等下一条用户消息 |
| `includeSubagents` | `true` | 是否也管子 agent，false 只盯顶层 |
| `systemPromptSection` | `true` | 是否往系统提示里写那段节拍规则 |
| `downgradeReasoningEffort` | `''` | 越界时降推理强度。留空 = 不用，**建议保持留空** |
| `reminderTag` | `思考节拍` | 提醒文案里方括号里的标签 |
| `logPath` | `''` | 事件日志路径，留空 = 不记 |

## 日志查看

插件没有界面。想知道它有没有在干活，给它开个日志：

```yaml
- id: think-budget
  config:
    logPath: 'D:/logs/think-budget.jsonl'
```

开完那个文件里会立刻多出一行装载记录，`config` 字段是这次实际生效的配置，
可以拿它核对配置有没有被读进去：

```json
{"at":"2026-01-01T00:00:00.000Z","event":"applied","node":"v26.5.0","headless":false,"config":{}}
```

之后每次出手也会往里追加一行：

```json
{"at":"...","sessionId":"...","kind":"no-conclusion-streak","streak":3,"reasoningChars":1284,"visibleChars":0,"toolCalls":2}
```

一行都没有，说明插件没装上，回去看看安装命令有没有报错。

## 权限

| | |
|---|---|
| 网络 | 不发任何请求 |
| 命令 | 不执行任何命令 |
| 工具 | 不加新工具，也不动你的工具列表 |
| 你的消息 | 不改写、不删除 |
| 会话 | 只往里加消息，不取消轮次、不拦截步骤 |
| 磁盘 | 只会碰 `logPath` 那个日志文件，默认还是关的 |

细节和已知限制写在[工作原理](docs/how-it-works.md)里。

## 卸载

```powershell
dsh plugin --profile web remove dsh-think-budget
```

源码方式装的，把补丁文件里那段 `- insert:` 删掉就行。插件不写任何持久状态，
删掉就干净了。

## 常见问题

**装完没反应？** 正常。它平时不出声，只有模型越界才说话。想看它有没有在跑，
按上面「日志查看」开个日志。

**会不会拖慢会话？** 不会，它就是数一下字数。

**能和其他插件一起用吗？** 能，用的都是 dsh 的公开扩展点。

## 更多文档

- [工作原理](docs/how-it-works.md)：判定规则的细节、用到的 dsh 接口、实现地图、已知限制
- [开发与测试](docs/development.md)：源码加载和编译产物的区别、构建、测试
- [排查](docs/troubleshooting.md)：日志字段、调阈值、装了两份怎么办

也可以直接跟 AI agent 说一句「照 https://github.com/superSizzzz/dsh-think-budget
的 README 帮我装上」，它读得懂。

## 许可

MIT，见 [LICENSE](./LICENSE)。
