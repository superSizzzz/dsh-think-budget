# dsh-think-budget

English | [中文](README.md)

A pacemaker for DeepSeek Harness agents that think for a long time without
saying anything. It gives a single step a character budget for reasoning, and
requires a visible conclusion to be written every few steps before the agent
carries on.

The plugin adds no tools, no services, no UI. It does exactly two things: it
registers a pacing rule in the system prompt, and it injects a reminder into
the session when the model crosses a line.

## What it watches

The symptom: after one prompt, the model runs a dozen steps — reasoning and
calling tools the whole way — while not a single word shows up in the
conversation. The user cannot tell whether it is making progress or stuck.

The criteria are deliberately plain:

- **One "reply" = one step** = one successful model call (a committed
  `assistant/message`). Failed attempts and cancelled streams do not count.
- **A "conclusion" = the visible body text of that step**, at least
  `minConclusionChars` characters after trimming. Reasoning does not count —
  the user cannot see it, so it is not a deliverable.
- The plugin acts when `maxStepsWithoutConclusion` consecutive steps carry no
  conclusion, or when a single step reasons past `maxReasoningCharsPerStep`
  characters without writing one.

## Two layers

**Prevention** — a "thinking pace" section in the system prompt:

```markdown
## 思考节拍

- 思考（reasoning）是内部草稿，用户看不到；正文才是交付物。不要把结论留在思考里。
- 每 3 次回复之内，至少写一次可见正文结论 —— 阶段判断也算，「目前还不确定，因为…」也算。
- 单次思考控制在约 4000 字以内。一件事推演到能下判断就够了，不要反复重推同一个问题。
- 先给结论，再继续调用工具；需要长任务时，用阶段结论代替沉默。
```

(The section is written in the deployment's language. Set `reminderTag` and
edit `src/policy.ts` if you want it in yours.)

Getting the model to cooperate up front beats correcting it afterwards. Turn
it off with `systemPromptSection: false` and only the second layer remains.

**Remedy** — a model-visible reminder injected when the line is crossed:

```
【思考节拍】你最近连续 3 次回复都没有写正文，只有思考和工具调用。
现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是
「还不确定，因为…」，但必须写出来。
写完之后如果还需要继续，再继续调用工具。
```

That message goes through `agent.inject()`, so it is a first-class user
message: it has an id, its own source kind (`think-budget`), it lands in the
session log, and it gets a collapsed summary in the UI. It is not a comment
and not a side channel — the model reads it the way it reads any other user
message.

The wording deliberately leaves an exit: "I'm not sure yet" counts as a
conclusion. It demands *something be said*, not *something be figured out* —
otherwise a model will invent a fake answer to satisfy the counter, which is
the easiest way for a plugin like this to do harm.

## Limits

**It cannot interrupt a reasoning stream that is already being generated.**

Reasoning is produced by the model and delivered over a streaming protocol.
By the time the harness receives those tokens, they exist. So "limiting
thinking length" lands here as:

- crossed the line → apply pressure on the next step (reminder injection);
- optional hard lever: crossed the line → serve that step's request at a lower
  reasoning effort (`downgradeReasoningEffort`, **off by default**).

Cutting off an in-flight reasoning stream needs a stream-level interrupt; that
is a different road. The only genuinely hard switch is reasoning effort, and
it is per-request state that can only be decided before a step begins.

Three more things, stated plainly:

- **It does not cancel turns, reject steps, or rewrite messages.** It only adds
  messages to the session. Stopping a runaway turn is another plugin's job
  (the `agent/turn-stopping` road).
- **Resumed sessions start counting from zero.** The ledger lives in memory and
  is counted from the live stream. Resuming a compacted session does not
  re-derive historical reasoning.
- **Downgrading is the only switch with side effects.** Set it to an effort the
  model does not support and that request fails with
  `UNSUPPORTED_REASONING_EFFORT`. Hence off by default, and used only once the
  no-conclusion streak reaches the threshold — the moment the model is
  evidently stuck.

## Install

The plugin does not install its own dependencies — `@deepseek-ai/*` is
provided by dsh, declared here as peerDependencies. So after cloning, link the
dependencies and mount the plugin into dsh's patch layer.

```powershell
# 1) clone wherever you keep plugins
git clone https://github.com/superSizzzz/dsh-think-budget.git D:\plugins\dsh-think-budget

# 2) link dependencies (creates a node_modules junction to dsh's own)
cd D:\plugins\dsh-think-budget
node scripts/link-deps.mjs

# 3) mount it — see the patch entry below
```

```yaml
- insert:
    - id: think-budget
      name: 'file:///D:/plugins/dsh-think-budget/src/index.ts'   # <- the line printed in step 2
      config:
        enabled: true
        maxReasoningCharsPerStep: 4000
        maxStepsWithoutConclusion: 3
```

Which file you append to decides the scope:

| File | Scope |
|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` | web profile only |
| `~/.dsh/cordis.patch.yml` | home layer, every profile |

Append to the end — do not replace what is already in that file. This is an
insert patch and coexists with existing entries. dsh profiles ship with
`patchReload: live`, so saving is hot-reloading; no restart needed.

To try it once without touching any profile file, the repo carries a ready-made
patch layer (replace `<plugin-dir>` with your actual directory):

```powershell
dsh web --patch <plugin-dir>/cordis.think-budget.yml
```

## Let an AI agent install it

The block below can be pasted straight to any AI agent that can act on your
machine (Claude Code, Cursor, another dsh — anything). It is self-contained.

```text
Install the dsh-think-budget plugin for DeepSeek Harness on this machine.

Repo: https://github.com/superSizzzz/dsh-think-budget

What it is: it gives a single agent step a character budget for reasoning, and
when several consecutive steps produce no visible conclusion it injects a
reminder into the session asking for a conclusion before continuing. The plugin
does exactly two things — adds a system-prompt section and injects a reminder.
It adds no tools and rewrites no messages.

Steps:
1. Clone it to a plugin directory of your choosing, e.g. D:\plugins\dsh-think-budget.
2. In that directory run `node scripts/link-deps.mjs --patch`. It creates a
   node_modules junction pointing at dsh's own dependency directory (without it
   the plugin cannot import `@deepseek-ai/*`), then prints a patch fragment with
   the path already filled in.
3. Append the printed `- insert:` block to the end of whichever of these files
   you choose — that decides the scope:
     ~/.dsh/cordis.patch.yml                -> home layer, every profile
     ~/.dsh/profiles/web/cordis.patch.yml   -> the web profile only
   Append it into the YAML array at the end. Do not replace existing plugin entries.
4. Verify: dsh profiles default to patchReload: live, so saving hot-reloads. To
   confirm it loaded, add `logPath: '<plugin-dir>/events.jsonl'` to that config
   and check whether the file contains a {"event":"applied", ...} line.

Notes:
- This is an insert patch; it coexists with what is already in the patch file.
  Do not touch other entries.
- The plugin directory must contain node_modules (created in step 2), or loading fails.
- No dsh restart is needed; restart only if hot reload does not pick it up.
- To pause it: set enabled: false in the config. To remove it: delete the insert block.
- Defaults are "3 consecutive steps without a conclusion" and "4000 reasoning
  characters per step". Widen to 5 / 8000 if it feels too chatty.
```

## Uninstall

Delete the `insert` block from `cordis.patch.yml`, or set `enabled: false` to
keep the code but stop all action. The plugin writes no persistent state, so
deleting is deleting.

## Configuration

Configuration lives in the `config:` block of that patch entry — there is no
separate config file and no settings UI. Save and it takes effect: the hot
reload re-validates the config and rebuilds the listeners. A bad value fails
loudly at reload time rather than silently falling back to a default.

```yaml
- insert:
    - id: think-budget
      name: 'file:///<plugin-dir>/src/index.ts'
      config:
        # <- the part you tune
        enabled: true
        maxReasoningCharsPerStep: 4000
        maxStepsWithoutConclusion: 3
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When false, no listener is installed at all |
| `maxReasoningCharsPerStep` | `4000` | Per-step reasoning character budget; only counted when the step wrote no conclusion. `0` disables this rule |
| `maxStepsWithoutConclusion` | `3` | Consecutive steps without a conclusion before one is demanded. `0` disables this rule |
| `minConclusionChars` | `12` | How long (after trimming) counts as a conclusion. Keeps "let me take a look" from clearing the counter |
| `cooldownSteps` | `2` | Minimum step gap between two reminders of the same kind |
| `maxRemindersPerTurn` | `5` | Reminder cap per turn; once reached it stays quiet until the next user message |
| `includeSubagents` | `true` | Whether sub-agents are governed too. False watches top-level agents only |
| `systemPromptSection` | `true` | Whether the "thinking pace" section is registered in the system prompt |
| `downgradeReasoningEffort` | `''` | Reasoning effort to switch to when the line is crossed. Empty means never (**recommended**) |
| `reminderTag` | `思考节拍` | The label inside the brackets of every reminder |
| `logPath` | `''` | Event log (JSONL). Empty means nothing is recorded |

Stricter: `maxStepsWithoutConclusion: 2`, `maxReasoningCharsPerStep: 2500`.
Looser: `maxStepsWithoutConclusion: 5`, `maxReasoningCharsPerStep: 8000`.

### Confirming it actually took effect

Add `logPath: '<plugin-dir>/events.jsonl'` to the config and save. That file
immediately gains a line:

```json
{"at":"2026-01-01T00:00:00.000Z","event":"applied","node":"v26.5.0","headless":false,"config":{"maxReasoningCharsPerStep":4000,...}}
```

The `config` field is the value that actually took effect. **That line present
means the plugin loaded and the configuration was read.** Every later reminder
appends to the same file too (format under Troubleshooting below).

No lines at all means the plugin was not loaded — go back and check the path in
the patch entry's `name`.

## Development

Zero build: dsh loads `src/index.ts` directly through Node's TypeScript type
stripping (Node ≥ 22.6). Save a change and the profile's `patchReload: live`
hot-reloads it — no compile step, no dsh restart.

```powershell
node scripts/link-deps.mjs   # run once after cloning
npm test                     # run both test files
```

Because loading relies on type stripping, avoid syntax that needs
transformation (`enum`, parameter properties, decorators), and keep the `.ts`
extension on relative imports.

## Tests

Both run directly — no dsh instance, no API quota:

```powershell
npm test                            # both at once
node test/tracker.test.mjs          # 43 assertions on the judging rules
node test/plugin.smoke.mjs          # 34 assertions on the wiring
```

`tracker.test.mjs` pins the brains: what counts as a conclusion, when to
speak up, how cooldown and quota work, how a new turn resets the ledger, and
that a disabled rule really stays silent.

`plugin.smoke.mjs` pins the wiring: `apply` does not throw, event names
register, streamed characters accumulate correctly, crossing the line really
calls `agent.inject()`, and the injected message is a complete user message
the harness accepts. It runs against a fake ctx and a fake agent.

To verify one layer further — that dsh's loader actually recognizes it — boot
an isolated instance that does not hold port 3080:

```powershell
dsh --profile web --patch <plugin-dir>\test\verify-load.yml --port 3199 --no-open
```

`verify-load.yml` disables the Feishu bridge first (a verification run should
not message anyone) and then writes the load marker to
`test/.verify-applied.jsonl`. A line carrying `"event":"applied"` means the
loader resolved the `file://` path, imported the `.ts`, validated the config,
and reached `apply`. Shut that instance down when you are done.

## Troubleshooting

Turn on `logPath` and every injected reminder appends one JSONL line:

```json
{"at":"2026-01-01T00:00:00.000Z","sessionId":"main-session-...","kind":"no-conclusion-streak","streak":3,"reasoningChars":1284,"visibleChars":0,"toolCalls":2}
```

Lines present means the plugin is working and the model really did cross the
line. No lines means either the model behaved, or the thresholds are too loose
(try a smaller `maxStepsWithoutConclusion`).

## Source map

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry: wire listeners, accumulate the stream, deliver reminders, register the system section |
| `src/tracker.ts` | Ledger and judging rules. Pure logic, touches no service |
| `src/policy.ts` | Everything said to the model (system section, reminder bodies, summaries) |
| `src/config.ts` | schemastery config schema and normalization |
| `scripts/link-deps.mjs` | Links `node_modules` to dsh's dependency directory |
| `cordis.think-budget.yml` | Ready-made patch layer for `--patch` |
| `test/tracker.test.mjs` | Judging-rule tests |
| `test/plugin.smoke.mjs` | Wiring tests |
| `test/verify-load.yml` | Patch layer for the isolated load check |

## Harness interfaces it relies on

All from dsh 0.1.7-rc.2's public event surface; nothing package-internal is
touched.

| Interface | Use |
|---|---|
| `agent/assistant-stream` | Read `text-delta` / `reasoning-delta` as they stream, accumulating "how long it reasoned, how much it wrote" |
| `agent.inject(UserMessage)` | Put a reminder where the model can see it |
| `agent/request` waterfall | Optional: rewrite this step's `reasoningEffort` |
| `systemPrompt.section()` | Register the "thinking pace" system section |
| `createUserMessage()` / `MessageSourceMap` | Build a valid message and declare its own source kind |

## License

MIT — see [LICENSE](./LICENSE).
