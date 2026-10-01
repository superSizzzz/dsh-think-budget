# dsh-think-budget

English | [中文](README.md)

dsh sometimes thinks for a long time without saying anything — you cannot tell
whether it is making progress or stuck. This plugin gives it a pace: a character
budget per step, and a nudge whenever several steps go by without visible prose.

## Install it

```powershell
dsh plugin --profile web add github:superSizzzz/dsh-think-budget
```

One command, live immediately — dsh reads the package's `dsh.bundle.patch` and
folds it into the profile.

```powershell
dsh plugin --profile web remove dsh-think-budget    # uninstall
```

| Item | Requirement |
|---|---|
| dsh | ≥ 0.1.7-rc.2 |
| Node | ≥ 22.6 |
| profile | Any — web / tui / headless all work |
| model | Any — only routes that emit reasoning trigger the over-budget rule |

Change the name after `--profile` to install into another profile; install once
per profile. To edit the source with instant hot reload, see
[Development](docs/development.md).

## How it works

Two triggers, either one fires it:

- **Several steps with no prose** — 3 by default. "Prose" means the part you can
  see in the conversation; reasoning does not count, because what you cannot see
  is not a deliverable.
- **One step reasoning too long** — 4000 characters by default, and that step
  wrote no prose either.

It works in two layers: a pacing rule written into the system prompt so the model
cooperates up front, and a reminder injected into the session when a line is
crossed. This is what the model receives:

```text
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

The wording deliberately leaves an exit: "I'm not sure yet" counts as a
conclusion. It demands *something be said*, not *something be figured out* —
otherwise a model will invent a fake answer to satisfy the counter.

## What it looks like when it fires

Both lines below are the plugin's own ledger entries, from a real session (the
session id is omitted).

First: three consecutive steps of reasoning and tool calls with zero prose, so
the plugin asked for a conclusion.

```json
{"at":"2026-09-26T09:15:30.056Z","kind":"no-conclusion-streak","streak":3,"reasoningChars":1840,"visibleChars":0,"toolCalls":2}
```

Second: later in the same session, a single step reasoned 4432 characters without
writing any prose.

```json
{"at":"2026-09-26T09:43:38.767Z","kind":"reasoning-over-budget","streak":1,"reasoningChars":4432,"visibleChars":0,"toolCalls":2}
```

Both took effect immediately: the model's next reply carried prose.

## Tuning it

Configuration lives in the patch entry's `config:` block — no separate config
file, no settings UI. To adjust how tight it is, append an override to
`~/.dsh/profiles/web/cordis.patch.yml` (list only the fields you change):

```yaml
- id: think-budget
  config:
    maxStepsWithoutConclusion: 5      # steps without prose before it speaks, default 3
    maxReasoningCharsPerStep: 8000    # per-step reasoning budget, default 4000
```

Saving is hot-reloading; no dsh restart. A bad value fails loudly at reload time
rather than silently falling back to a default.

Stricter: `maxStepsWithoutConclusion: 2`, `maxReasoningCharsPerStep: 2500`.
Every field is listed under [Configuration](#configuration) below.

### Confirming it actually runs

Add a log path:

```yaml
- id: think-budget
  config:
    logPath: 'D:/logs/think-budget.jsonl'
```

That file immediately gains a `{"event":"applied",…}` line (containing the config
that actually took effect) — its presence means the plugin loaded. Every later
reminder appends another line.

No lines at all means the plugin did not load — go back and check whether the
install command succeeded.

## What it does not touch

| | |
|---|---|
| Network | Sends no requests |
| Commands | Executes nothing |
| Tools | Adds no tools, does not change your tool list |
| Your messages | Never rewrites or deletes them |
| Session | Only appends messages; does not cancel turns or reject steps |
| Disk | The only thing it touches is the `logPath` log file, off by default |

Full permissions and known limits: [How it works](docs/how-it-works.md).

## Uninstall

```powershell
dsh plugin --profile web remove dsh-think-budget
```

For a source install, delete the `- insert:` block from your patch file. The
plugin writes no persistent state, so deleting is deleting.

## FAQ

**Nothing happened after installing.** Expected — it only speaks up when the
model actually crosses a line. To see whether it is running, add a `logPath` as
described above.

**Does it slow sessions down?** No. It counts characters as the stream goes by;
no extra model calls, nothing blocking.

**Can it coexist with other plugins?** Yes. It uses only dsh's public extension
points, so it does not interfere with what you already run.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When false, no listener is installed at all |
| `maxReasoningCharsPerStep` | `4000` | Per-step reasoning budget; only counted when the step wrote no prose. `0` disables this rule |
| `maxStepsWithoutConclusion` | `3` | Consecutive steps without prose before one is demanded. `0` disables this rule |
| `minConclusionChars` | `12` | How long (after trimming) counts as prose. Keeps "let me take a look" from clearing the counter |
| `cooldownSteps` | `2` | Minimum step gap between two reminders of the same kind |
| `maxRemindersPerTurn` | `5` | Reminder cap per turn; once reached it stays quiet until the next user message |
| `includeSubagents` | `true` | Whether sub-agents are governed too. False watches top-level agents only |
| `systemPromptSection` | `true` | Whether the pacing section is registered in the system prompt |
| `downgradeReasoningEffort` | `''` | Reasoning effort to switch to when a line is crossed. Empty means never (**recommended**) |
| `reminderTag` | `思考节拍` | The label inside the brackets of every reminder |
| `logPath` | `''` | Event log (JSONL). Empty means nothing is recorded |

## Going deeper

The detailed internals are written in Chinese under `docs/`:

- [工作原理](docs/how-it-works.md) — judging details, the dsh events it uses, source map, known limits
- [开发与测试](docs/development.md) — source vs compiled loading, build, tests
- [排查](docs/troubleshooting.md) — log fields, tuning, running two copies

You can also just tell an AI agent: "install it by following the README at
https://github.com/superSizzzz/dsh-think-budget" — it can read.

## License

MIT — see [LICENSE](./LICENSE).
