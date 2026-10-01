# dsh-think-budget

English | [中文](README.md)

When dsh thinks for a while it can leave the screen blank for a long stretch, and
you have no way to tell whether it is working or stuck.

This plugin gives it a pace: a character cap per step, and a nudge whenever
several steps go by without any visible prose.

## Contents

- [Install](#install)
- [What it does](#what-it-does)
- [Usage](#usage)
- [Configuring the step budget](#configuring-the-step-budget)
- [Viewing the log](#viewing-the-log)
- [Permissions](#permissions)
- [Uninstall](#uninstall)
- [FAQ](#faq)
- [More docs](#more-docs)
- [License](#license)

## Install

```powershell
dsh plugin --profile web add github:superSizzzz/dsh-think-budget
```

One command, and that is the whole install. dsh reads the `dsh.bundle.patch`
inside the package and folds it into the current profile, so there is nothing to
hand-write.

To take it back out:

```powershell
dsh plugin --profile web remove dsh-think-budget
```

| Item | Requirement |
|---|---|
| dsh | ≥ 0.1.7-rc.2 |
| Node | ≥ 22.6 |
| profile | Any. web / tui / headless all work |
| model | Any. Only routes that emit reasoning can trigger the over-budget rule |

For another profile, change the name after `--profile` and install once per
profile.

If you would rather edit the code, the source route is easier. See
[Development](docs/development.md).

## What it does

It watches two things, and either one is enough to make it speak up.

The first is several steps in a row with no prose, three by default. "Prose"
means the part you can see in the conversation. The model's reasoning does not
count: if you cannot see it, as far as you are concerned it never happened.

The second is a single step reasoning for too long, 4000 characters by default.
That one also requires the step to have written no prose. If it reasoned for a
while and still told you what it concluded, the plugin leaves it alone.

It works in two layers. Normally it puts a pacing rule into the system prompt so
the model keeps an eye on itself. When a line is actually crossed it drops a
reminder into the session. This is what the model reads:

```text
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

That line about "I'm not sure yet" counting as a conclusion is deliberate. It
asks the model to say something, not to figure everything out. Otherwise a model
trying to satisfy a counter will invent an answer, which is worse than silence.

## Usage

There is nothing to do after installing. It runs on its own and does not slow the
session down; it only counts characters as the stream goes by and makes no extra
model calls.

Most of the time it is quiet. It speaks up only when the model actually crosses a
line. The two lines below came out of a real session (session id omitted):

```json
{"at":"2026-09-26T09:15:30.056Z","kind":"no-conclusion-streak","streak":3,"reasoningChars":1840,"visibleChars":0,"toolCalls":2}
```

```json
{"at":"2026-09-26T09:43:38.767Z","kind":"reasoning-over-budget","streak":1,"reasoningChars":4432,"visibleChars":0,"toolCalls":2}
```

The first is three steps of nothing but reasoning and tool calls, zero prose, so
it asked for a conclusion. The second is later in the same session, where one
step reasoned 4432 characters and still wrote nothing.

Both worked on the spot. The model's next reply had prose in it.

## Configuring the step budget

Configuration lives in the patch entry that installs it. There is no separate
config file and no settings UI.

To loosen or tighten it, add an override to the end of
`~/.dsh/profiles/web/cordis.patch.yml`, listing only the fields you want to
change:

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 5      # steps without prose before it speaks, default 3
    maxReasoningCharsPerStep: 8000    # per-step reasoning cap, default 4000
```

Saving is enough, no dsh restart. A bad value reports an error at reload instead
of quietly falling back to a default.

For a tighter setting: `maxStepsWithoutConclusion: 2`,
`maxReasoningCharsPerStep: 2500`.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When false, no listener is installed at all |
| `maxReasoningCharsPerStep` | `4000` | Per-step reasoning cap, counted only when the step wrote no prose. `0` disables this rule |
| `maxStepsWithoutConclusion` | `3` | Consecutive steps without prose before it asks for one. `0` disables this rule |
| `minConclusionChars` | `12` | How long, after trimming, counts as prose. Keeps "let me take a look" from clearing the counter |
| `cooldownSteps` | `2` | Minimum gap in steps between two reminders of the same kind |
| `maxRemindersPerTurn` | `5` | Reminder cap per turn. Once reached it stays quiet until the next user message |
| `includeSubagents` | `true` | Whether sub-agents are governed too. False watches top-level agents only |
| `systemPromptSection` | `true` | Whether the pacing rule is written into the system prompt |
| `downgradeReasoningEffort` | `''` | Reasoning effort to switch to when a line is crossed. Empty means never, **which is the recommended setting** |
| `reminderTag` | `思考节拍` | The label inside the brackets of every reminder |
| `logPath` | `''` | Event log path. Empty means nothing is recorded |

## Viewing the log

The plugin has no interface. To find out whether it is doing anything, give it a
log:

```yaml
- id: think-budget
  config:
    logPath: 'D:/logs/think-budget.jsonl'
```

The file immediately gains a load record. Its `config` field is the configuration
that actually took effect, which is a handy way to confirm your settings were
read:

```json
{"at":"2026-01-01T00:00:00.000Z","event":"applied","node":"v26.5.0","headless":false,"config":{}}
```

Every reminder afterwards appends a line too:

```json
{"at":"...","sessionId":"...","kind":"no-conclusion-streak","streak":3,"reasoningChars":1284,"visibleChars":0,"toolCalls":2}
```

No lines at all means the plugin never loaded. Go back and check whether the
install command reported an error.

## Permissions

| | |
|---|---|
| Network | Sends no requests |
| Commands | Executes nothing |
| Tools | Adds no tools and does not touch your tool list |
| Your messages | Never rewritten, never deleted |
| Session | Only appends messages. Does not cancel turns or reject steps |
| Disk | Only the `logPath` log file, and that is off by default |

Details and known limits are in [How it works](docs/how-it-works.md).

## Uninstall

```powershell
dsh plugin --profile web remove dsh-think-budget
```

For a source install, delete the `- insert:` block from your patch file. The
plugin keeps no state, so removing it leaves nothing behind.

## FAQ

**Nothing happened after installing.** That is normal. It stays quiet until the
model crosses a line. To see whether it is running, turn on a log as described
above.

**Does it slow sessions down?** No. It counts characters as they stream past.

**Can it run alongside other plugins?** Yes. It only uses dsh's public extension
points.

## More docs

- [工作原理](docs/how-it-works.md): judging rules in detail, the dsh interfaces it uses, source map, known limits
- [开发与测试](docs/development.md): source loading vs compiled output, build, tests
- [排查](docs/troubleshooting.md): log fields, tuning thresholds, what to do when two copies are installed

You can also tell an AI agent: "install it by following the README at
https://github.com/superSizzzz/dsh-think-budget". It can read.

## License

MIT, see [LICENSE](./LICENSE).
