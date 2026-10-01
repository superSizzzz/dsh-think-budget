# 排查

[← 回 README](../README.md)

## 先打开日志

插件没有 UI，`logPath` 是它唯一的可观测面。加一行：

```yaml
- id: think-budget
  config:
    logPath: 'D:/logs/think-budget.jsonl'
```

保存后那个文件会立刻多出一行装载记录：

```json
{"at":"2026-01-01T00:00:00.000Z","event":"applied","node":"v26.5.0","headless":false,"config":{}}
```

`config` 字段是这次实际生效的值 —— 用它核对你的配置有没有被读进去。

之后每次出手追加一行：

```json
{"at":"...","sessionId":"...","kind":"no-conclusion-streak","streak":3,"reasoningChars":1284,"visibleChars":0,"toolCalls":2}
```

| 字段 | 含义 |
|---|---|
| `kind` | 哪条规则触发的：`no-conclusion-streak`（连续没正文）或 `reasoning-over-budget`（单步思考超预算） |
| `streak` | 触发时连续没写正文的步数 |
| `reasoningChars` | 这一步思考了多少字 |
| `visibleChars` | 这一步写了多少正文 |
| `toolCalls` | 这一步调了几个工具 |

## 症状与处置

**一行日志都没有。**

插件没被加载。按装的顺序往回查：用 `dsh plugin add` 装的，看那条命令有没有报错（包缺
`dsh.bundle` 时它会把 `package.json` 回滚）；源码方式装的，看补丁里 `name` 那个路径对
不对、插件目录下有没有 `node_modules`。

**有 `applied` 一行，但之后再没有记录。**

插件在跑，只是模型这段时间没越界 —— 正常。嫌它太松就调小阈值：

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 2
    maxReasoningCharsPerStep: 2500
```

**它太吵了。**

调大阈值、拉长冷却，或者只留一条规则：

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 6
    cooldownSteps: 4
    maxRemindersPerTurn: 2
    maxReasoningCharsPerStep: 0     # 0 = 关掉这一条规则
```

**每条提醒出现两遍。**

装了两份。用 `dsh plugin add` 装过之后，`~/.dsh/cordis.patch.yml` 或 profile 补丁里可能
还留着一条指向 `src/index.ts` 的 `think-budget` —— 两条 id 相同，都会生效。删掉其中一条。

**想临时停手但保留代码。**

```yaml
- id: think-budget
  config:
    enabled: false
```

**恢复的会话计数不对。**

这是设计如此：账本只在内存里，从流现数。恢复（尤其是恢复压缩过的）会话不会把历史推理
重算一遍，所以从零开始。

**`downgradeReasoningEffort` 填了之后请求开始失败。**

填的档位这个模型不支持，请求会以 `UNSUPPORTED_REASONING_EFFORT` 终止。把它清空即可 ——
这个开关本来就推荐保持关闭。

## 完全卸掉

```powershell
dsh plugin --profile web remove dsh-think-budget
```

源码方式装的，从补丁文件里删掉那段 `- insert:`。插件不写任何持久状态；`logPath` 那个
日志文件是它留下的唯一痕迹，自己删掉即可。
