/** 每 agent 一份账本；同一个 tracker 只服务一个 agent。 */
export class ThinkBudgetTracker {
    config;
    turn = 0;
    streak = 0;
    remindersThisTurn = 0;
    lastReminderStep = {
        'no-conclusion-streak': Number.NEGATIVE_INFINITY,
        'reasoning-over-budget': Number.NEGATIVE_INFINITY,
    };
    lastStepKey = '';
    constructor(config) {
        this.config = config;
    }
    /** 当前连续无结论的步数。 */
    get noConclusionStreak() {
        return this.streak;
    }
    /** 这一轮已经注入过几条提醒。 */
    get reminders() {
        return this.remindersThisTurn;
    }
    /** 当前轮次号；0 表示还没观察到任何步骤。 */
    get currentTurn() {
        return this.turn;
    }
    /**
     * 是否该对这个请求降推理强度。
     *
     * 只有配置了降档值、且连续无结论已经到阈值时才为真 —— 也就是模型
     * 明显陷在思考里出不来的那一刻。调用方负责确认档位合法。
     */
    shouldDowngrade() {
        if (this.config.downgradeReasoningEffort.length === 0)
            return false;
        if (this.config.maxStepsWithoutConclusion <= 0)
            return false;
        return this.streak >= this.config.maxStepsWithoutConclusion;
    }
    /** 清空账本。新一轮用户输入、或 agent 被取消时调用。 */
    reset() {
        this.streak = 0;
        this.remindersThisTurn = 0;
        this.lastReminderStep['no-conclusion-streak'] = Number.NEGATIVE_INFINITY;
        this.lastReminderStep['reasoning-over-budget'] = Number.NEGATIVE_INFINITY;
        this.lastStepKey = '';
    }
    /**
     * 记一个已完成的步骤，返回该不该出声。
     *
     * @returns 需要提醒时返回判定结果，否则 null（沉默是多数情况）。
     */
    observe(observation) {
        const { turn, step, reasoningChars, visibleChars, toolCalls } = observation;
        if (turn !== this.turn) {
            // 新的一轮 = 新的指令，旧账不带到新任务上。
            this.turn = turn;
            this.reset();
        }
        // 同一步被重复结算（重试、回放）时不重复计分：这一步已经记过了。
        const stepKey = `${turn}:${step}`;
        if (stepKey !== this.lastStepKey) {
            this.lastStepKey = stepKey;
            if (visibleChars >= this.config.minConclusionChars) {
                this.streak = 0;
            }
            else {
                this.streak += 1;
            }
        }
        // 有结论就不打扰 —— 用户要的是「有输出」，不是「思考必须短」。
        if (visibleChars >= this.config.minConclusionChars)
            return null;
        if (this.config.maxRemindersPerTurn > 0 && this.remindersThisTurn >= this.config.maxRemindersPerTurn) {
            return null;
        }
        const base = { streak: this.streak, reasoningChars, visibleChars, toolCalls };
        if (this.config.maxStepsWithoutConclusion > 0
            && this.streak >= this.config.maxStepsWithoutConclusion
            && this.cooldownPassed('no-conclusion-streak', step)) {
            this.charge('no-conclusion-streak', step);
            return { kind: 'no-conclusion-streak', ...base };
        }
        if (this.config.maxReasoningCharsPerStep > 0
            && reasoningChars > this.config.maxReasoningCharsPerStep
            && this.cooldownPassed('reasoning-over-budget', step)) {
            this.charge('reasoning-over-budget', step);
            return { kind: 'reasoning-over-budget', ...base };
        }
        return null;
    }
    cooldownPassed(kind, step) {
        const last = this.lastReminderStep[kind];
        if (!Number.isFinite(last))
            return true;
        return step - last >= this.config.cooldownSteps;
    }
    charge(kind, step) {
        this.lastReminderStep[kind] = step;
        this.remindersThisTurn += 1;
    }
}
