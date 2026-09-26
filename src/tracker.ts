/**
 * 思考/结论账本 —— 纯逻辑，不碰 dsh 任何服务。
 *
 * 分开写的理由是可测：判定规则（什么算结论、什么时候该出声、冷却与
 * 配额）是这个插件的全部智力，单独一个文件就能用 node 直跑覆盖，
 * 不需要起 harness。
 *
 * 计数语义：一步 = 一次成功的模型调用（一个 committed 的
 * assistant/message）。用户看到的「一直思考不输出」正是「连跑好几步
 * 一个字都没有」，所以按步计数跟体感对齐。
 */
import type { ResolvedConfig } from './config.ts'

/** 一次成功步骤的观测值，全是从交付给用户的流里数出来的。 */
export interface StepObservation {
  /** 所属轮次。变化即代表新一轮用户输入，账本清空。 */
  turn: number
  /** 轮次内的步骤号，用于冷却与配额计算。 */
  step: number
  /** 这一步的思考（reasoning）字符数。 */
  reasoningChars: number
  /** 这一步的可见正文（text）字符数。 */
  visibleChars: number
  /** 这一步请求的工具调用数量。 */
  toolCalls: number
}

/** 该不该出声、出哪一种声。 */
export type VerdictKind = 'no-conclusion-streak' | 'reasoning-over-budget'

export interface Verdict {
  kind: VerdictKind
  /** 触发时累计的连续无结论步数。 */
  streak: number
  /** 触发那一步的思考字符数。 */
  reasoningChars: number
  /** 触发那一步的可见正文字符数。 */
  visibleChars: number
  /** 触发那一步的工具调用数。 */
  toolCalls: number
}

/** 每 agent 一份账本；同一个 tracker 只服务一个 agent。 */
export class ThinkBudgetTracker {
  private readonly config: ResolvedConfig
  private turn = 0
  private streak = 0
  private remindersThisTurn = 0
  private readonly lastReminderStep: Record<VerdictKind, number> = {
    'no-conclusion-streak': Number.NEGATIVE_INFINITY,
    'reasoning-over-budget': Number.NEGATIVE_INFINITY,
  }
  private lastStepKey = ''

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /** 当前连续无结论的步数。 */
  get noConclusionStreak(): number {
    return this.streak
  }

  /** 这一轮已经注入过几条提醒。 */
  get reminders(): number {
    return this.remindersThisTurn
  }

  /** 当前轮次号；0 表示还没观察到任何步骤。 */
  get currentTurn(): number {
    return this.turn
  }

  /**
   * 是否该对这个请求降推理强度。
   *
   * 只有配置了降档值、且连续无结论已经到阈值时才为真 —— 也就是模型
   * 明显陷在思考里出不来的那一刻。调用方负责确认档位合法。
   */
  shouldDowngrade(): boolean {
    if (this.config.downgradeReasoningEffort.length === 0) return false
    if (this.config.maxStepsWithoutConclusion <= 0) return false
    return this.streak >= this.config.maxStepsWithoutConclusion
  }

  /** 清空账本。新一轮用户输入、或 agent 被取消时调用。 */
  reset(): void {
    this.streak = 0
    this.remindersThisTurn = 0
    this.lastReminderStep['no-conclusion-streak'] = Number.NEGATIVE_INFINITY
    this.lastReminderStep['reasoning-over-budget'] = Number.NEGATIVE_INFINITY
    this.lastStepKey = ''
  }

  /**
   * 记一个已完成的步骤，返回该不该出声。
   *
   * @returns 需要提醒时返回判定结果，否则 null（沉默是多数情况）。
   */
  observe(observation: StepObservation): Verdict | null {
    const { turn, step, reasoningChars, visibleChars, toolCalls } = observation

    if (turn !== this.turn) {
      // 新的一轮 = 新的指令，旧账不带到新任务上。
      this.turn = turn
      this.reset()
    }

    // 同一步被重复结算（重试、回放）时不重复计分：这一步已经记过了。
    const stepKey = `${turn}:${step}`
    if (stepKey !== this.lastStepKey) {
      this.lastStepKey = stepKey
      if (visibleChars >= this.config.minConclusionChars) {
        this.streak = 0
      } else {
        this.streak += 1
      }
    }

    // 有结论就不打扰 —— 用户要的是「有输出」，不是「思考必须短」。
    if (visibleChars >= this.config.minConclusionChars) return null

    if (this.config.maxRemindersPerTurn > 0 && this.remindersThisTurn >= this.config.maxRemindersPerTurn) {
      return null
    }

    const base = { streak: this.streak, reasoningChars, visibleChars, toolCalls }

    if (
      this.config.maxStepsWithoutConclusion > 0
      && this.streak >= this.config.maxStepsWithoutConclusion
      && this.cooldownPassed('no-conclusion-streak', step)
    ) {
      this.charge('no-conclusion-streak', step)
      return { kind: 'no-conclusion-streak', ...base }
    }

    if (
      this.config.maxReasoningCharsPerStep > 0
      && reasoningChars > this.config.maxReasoningCharsPerStep
      && this.cooldownPassed('reasoning-over-budget', step)
    ) {
      this.charge('reasoning-over-budget', step)
      return { kind: 'reasoning-over-budget', ...base }
    }

    return null
  }

  private cooldownPassed(kind: VerdictKind, step: number): boolean {
    const last = this.lastReminderStep[kind]
    if (!Number.isFinite(last)) return true
    return step - last >= this.config.cooldownSteps
  }

  private charge(kind: VerdictKind, step: number): void {
    this.lastReminderStep[kind] = step
    this.remindersThisTurn += 1
  }
}
