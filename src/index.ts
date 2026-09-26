/**
 * dsh-think-budget —— 思考节拍器。
 *
 * 解决的现象：模型闷头想很久（reasoning 很长、连着好几步只调工具），
 * 屏幕上一直不出现正文，用户不知道它到底有没有进展。
 *
 * 插件做两件事，一件预防一件补救：
 *
 *   预防  往系统提示里写一段「思考节拍」规则，让模型一开始就配合。
 *   补救  盯着流出来的思考/正文长度，越界时往会话里注入一条提醒
 *         （模型可见的 user 消息），要求它先给结论再继续。
 *
 * 边界要说清楚：**插件拦不住正在生成的思考流**。reasoning 由模型端
 * 产出，harness 只能收。所以「限制思考长度」在这里的落地方式是「越界
 * 就施压 + 可选降推理档」，不是「到点掐断」。真正的硬约束只有
 * `downgradeReasoningEffort`（默认关，见 config.ts）。
 *
 * 加载方式（本地 checkout，profile 默认 patchReload: live，改代码即热重载）：
 *   在 profile 的 cordis.patch.yml 里 insert 一条，name 指向本文件的 file:// URL。
 *   跑 `node scripts/link-deps.mjs --patch` 会打印一份路径已经填好的片段。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Config, readConfig, resolveConfig, type ResolvedConfig } from './config.ts'
import { ThinkBudgetTracker, type Verdict } from './tracker.ts'
import { reminderSummary, reminderText, systemSectionText } from './policy.ts'

/**
 * 本插件自己声明的消息来源 kind。
 *
 * harness 的 `MessageSourceMap` 是合并可扩展的（每个生产者声明自己的
 * kind）。注入的提醒必须能被看成「不是用户手打的那一类」，否则 UI 会
 * 把它渲染成用户发言，飞书桥那类只认 `kind === 'user'` 的消费者也会
 * 被误触发。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'think-budget': { kind: 'think-budget'; form: 'notice'; summary: string }
  }
}

export const name = 'think-budget'
/** 全部走软取：缺哪个服务就少一路能力，不让插件本身加载失败。 */
export const inject: string[] = []
export { Config }

/** 系统提示段落的排序位置。700 落在团队策略（600）与 PTC 策略（800）之间。 */
const SECTION_ORDER = 700

/** 一次模型尝试的累计量。attempt 是重试粒度，一个 step 可能有多次。 */
interface AttemptBucket {
  turn: number
  step: number
  reasoningChars: number
  visibleChars: number
  toolCalls: number
}

/** 每个 agent 一份：自己的账本 + 在途的尝试桶。 */
interface AgentState {
  tracker: ThinkBudgetTracker
  attempts: Map<unknown, AttemptBucket>
}

interface SystemPromptLike {
  section(section: { name: string; order: number; text: string; interpolate?: boolean }): () => void
}

interface AgentRegistryLike {
  roots(): Agent[]
}

export function apply(ctx: Context, rawConfig: unknown): void {
  const config = readConfig(rawConfig)
  if (!config.enabled) return

  const resolved = resolveConfig(config)
  const states = new WeakMap<Agent, AgentState>()
  const scopeCache = new WeakMap<Agent, boolean>()
  const logger = createLogger(config.logPath)

  const stateOf = (agent: Agent): AgentState => {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const created: AgentState = { tracker: new ThinkBudgetTracker(resolved), attempts: new Map() }
    states.set(agent, created)
    return created
  }

  /**
   * 是否该管这个 agent。
   *
   * 判定结果按 agent 缓存：一次运行里「是不是顶层 agent」不会变，而
   * 这个判断在 chunk 帧上会被问到每一片 token。
   */
  const shouldTrack = (agent: Agent): boolean => {
    if (config.includeSubagents) return true
    const cached = scopeCache.get(agent)
    if (cached !== undefined) return cached

    let topLevel = true
    try {
      const registry = (ctx as unknown as { agents?: AgentRegistryLike }).agents
      const roots = registry?.roots?.()
      if (Array.isArray(roots)) topLevel = roots.some((root) => root.id === agent.id)
    } catch {
      // 拿不到注册表时不区分，宁可多管也不漏管。
      topLevel = true
    }
    scopeCache.set(agent, topLevel)
    return topLevel
  }

  /** 把提醒投进模型看得见的地方。任何失败都吞掉：插件不许打断会话。 */
  const deliver = (agent: Agent, verdict: Verdict): void => {
    try {
      agent.inject(createUserMessage({
        content: [{ type: 'text' as const, text: reminderText(verdict, resolved) }],
        source: {
          kind: 'think-budget',
          form: 'notice',
          summary: reminderSummary(verdict),
        },
      }))
      logger({
        at: new Date().toISOString(),
        sessionId: agent.id,
        kind: verdict.kind,
        streak: verdict.streak,
        reasoningChars: verdict.reasoningChars,
        visibleChars: verdict.visibleChars,
        toolCalls: verdict.toolCalls,
      })
    } catch {
      // 投递失败（agent 已退出等）不是错误，下一次有机会再说。
    }
  }

  // ---- 观测：从交付给用户的流里量思考和正文 ----
  ctx.on('agent/assistant-stream', (payload: { agent?: Agent; frame?: AssistantStreamFrame }) => {
    // 整个 handler 兜一层：cordis 会按监听器隔离同步抛错，但节拍器是
    // 纯附加能力，任何意外都不该在别人的事件派发里留下噪声。
    try {
      observe(payload)
    } catch {
      // 观测失败只丢这一次样本。
    }
  })

  function observe(payload: { agent?: Agent; frame?: AssistantStreamFrame }): void {
    const agent = payload.agent
    const frame = payload.frame
    if (agent === undefined || frame === undefined) return
    if (!shouldTrack(agent)) return

    const state = stateOf(agent)

    if (frame.type === 'start') {
      state.attempts.set(frame.attemptId, {
        turn: frame.turn,
        step: frame.step,
        reasoningChars: 0,
        visibleChars: 0,
        toolCalls: 0,
      })
      return
    }

    if (frame.type === 'chunk') {
      const bucket = state.attempts.get(frame.attemptId)
      if (bucket === undefined) return
      const chunk = frame.chunk
      if (chunk.type === 'reasoning-delta') {
        bucket.reasoningChars += chunk.text.length
      } else if (chunk.type === 'text-delta') {
        bucket.visibleChars += chunk.text.length
      } else if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') {
        bucket.toolCalls += 1
      }
      return
    }

    // end：只在持久消息真的提交后结算。abandoned（重试前那次失败、
    // 中途取消）不算一步 —— 模型没说完的话不该记在它账上。
    const bucket = state.attempts.get(frame.attemptId)
    state.attempts.delete(frame.attemptId)
    if (bucket === undefined) return
    if (frame.outcome.kind !== 'committed') return
    if (bucket.reasoningChars === 0 && bucket.visibleChars === 0) return

    const verdict = state.tracker.observe({
      turn: bucket.turn,
      step: bucket.step,
      reasoningChars: bucket.reasoningChars,
      visibleChars: bucket.visibleChars,
      toolCalls: bucket.toolCalls,
    })
    if (verdict !== null) deliver(agent, verdict)
  }

  // ---- 硬手段（默认关）：越界时把这一步的推理强度降下来 ----
  if (resolved.downgradeReasoningEffort.length > 0) {
    ctx.on('agent/request', async (
      payload: { agent?: Agent },
      next: () => Promise<Record<string, unknown>>,
    ) => {
      const upstream = await next()
      const agent = payload.agent
      if (agent === undefined || upstream === undefined || upstream === null) return upstream
      const state = states.get(agent)
      if (state === undefined || !state.tracker.shouldDowngrade()) return upstream
      // 档位是否合法由 harness 的 prepareCall() 判定；填错会以
      // UNSUPPORTED_REASONING_EFFORT 终止这一次请求，所以这个开关默认关。
      return { ...upstream, reasoningEffort: resolved.downgradeReasoningEffort }
    })
  }

  // ---- 预防：把节拍写进系统提示 ----
  if (config.systemPromptSection) {
    const text = systemSectionText(resolved)
    if (text.length > 0) {
      try {
        const systemPrompt = (ctx as unknown as { systemPrompt?: SystemPromptLike }).systemPrompt
        if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
          ctx.effect(() => systemPrompt.section({
            name: 'think-budget:policy',
            order: SECTION_ORDER,
            text,
          }))
        }
      } catch {
        // 没有系统提示注册表时降级为「只有事后提醒」，不影响加载。
      }
    }
  }

  // 装载留痕：配了 logPath 就写一行，用来回答「插件到底装上没有」。
  logger({
    at: new Date().toISOString(),
    event: 'applied',
    node: process.version,
    headless: process.argv.includes('--headless'),
    config: resolved,
  })
}

interface LogEntry {
  [key: string]: unknown
}

/**
 * 事件日志。默认关闭。
 *
 * 刻意不走 harness 的 logger：这个插件最需要排查的时刻恰恰是「它到底
 * 有没有在管事」，一条独立落到自己文件里的 JSONL 比混在别人日志里好用。
 * 写失败什么都不做 —— 记账不该影响会话。
 */
function createLogger(logPath: string): (entry: LogEntry) => void {
  if (logPath.trim().length === 0) return () => {}
  let ready = false
  return (entry) => {
    try {
      if (!ready) {
        mkdirSync(dirname(logPath), { recursive: true })
        ready = true
      }
      appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // 落盘失败不是错误。
    }
  }
}
