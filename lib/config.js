/**
 * think-budget 的配置 schema。
 *
 * 用 schemastery（dsh 全家的配置校验器）声明，导出名必须是 `Config`：
 * loader 拿它对 profile config 段做校验、填默认值，再把结果传进 `apply`。
 *
 * 保持扁平 —— 嵌套对象在 schemastery 里的 default 语义容易踩坑。
 * 字段注释以「这个旋钮实际改变什么行为」为准，不复述字段名。
 */
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    /** 总开关。false 时插件照常挂载，但一个监听器都不装、一条提醒都不发。 */
    enabled: z.boolean().default(true),
    /**
     * 单个步骤的思考字符预算。
     *
     * 只在「这一步没给出可见结论」时才算数：思考超预算 + 没结论 = 一次
     * 提醒。已经写了结论的步骤即使思考很长也不打扰 —— 用户要的是
     * 「别一直不吭声」，不是「思考必须短」。0 表示关掉这一项。
     */
    maxReasoningCharsPerStep: z.number().default(4000),
    /**
     * 连续多少步没有可见结论就强制要一条。
     *
     * 计数按「步骤」走（一次模型调用 = 一步），因为用户看到卡住的正是
     * 「跑了十几步一个字都没输出」。0 表示关掉这一项。
     */
    maxStepsWithoutConclusion: z.number().default(3),
    /**
     * 多长的正文才算「结论」。去空白后按字符数算。
     *
     * 定这条是为了让「让我看看」「好的」这类过渡语不算数 —— 否则模型
     * 用一句废话就能把节拍器清空。默认 12 约等于一个短句。
     */
    minConclusionChars: z.number().default(12),
    /** 同一种提醒两次之间的最小步数间隔，防止连环轰炸。 */
    cooldownSteps: z.number().default(2),
    /** 单轮最多注入几条提醒。到上限后这一轮闭嘴，等下一条用户消息重置。 */
    maxRemindersPerTurn: z.number().default(5),
    /** 是否也管子 agent（subagent）的会话。关掉只盯主 agent。 */
    includeSubagents: z.boolean().default(true),
    /**
     * 是否往系统提示里写一段「思考节拍」规则。
     *
     * 这是预防层：写进去模型会主动配合，比事后提醒省事。关掉就只剩
     * 事后施压（提醒注入照常工作）。
     */
    systemPromptSection: z.boolean().default(true),
    /**
     * 可选硬降档：越界后把该步的推理强度换成这个值。
     *
     * **默认关闭**（空串）。它真的动模型请求头，填了模型不支持的档位会
     * 让 `prepareCall()` 抛 UNSUPPORTED_REASONING_EFFORT 并打断这一次
     * 请求 —— 所以只在确认过该模型档位之后再开。合法值形如
     * `minimal` / `low` / `medium` / `high`，以模型实际暴露的为准。
     */
    downgradeReasoningEffort: z.string().default(''),
    /** 提醒里对模型说话时用的语言标签，只影响文案前缀。 */
    reminderTag: z.string().default('思考节拍'),
    /**
     * 事件日志路径（JSONL）。留空则完全不记。
     *
     * 每次注入提醒记一行。排查「插件到底有没有在管事」时开它，比在
     * harness 日志里翻有用。
     */
    logPath: z.string().default(''),
});
/** schemastery 校验后的配置在字段层面已是具体值，这里只做一层防御性读取。 */
export function readConfig(raw) {
    return Config(raw ?? {});
}
export function resolveConfig(config) {
    const zeroOrPositive = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    const nonNegative = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
    return {
        maxReasoningCharsPerStep: zeroOrPositive(config.maxReasoningCharsPerStep),
        maxStepsWithoutConclusion: zeroOrPositive(config.maxStepsWithoutConclusion),
        minConclusionChars: nonNegative(config.minConclusionChars),
        cooldownSteps: nonNegative(config.cooldownSteps),
        maxRemindersPerTurn: zeroOrPositive(config.maxRemindersPerTurn),
        downgradeReasoningEffort: config.downgradeReasoningEffort.trim(),
        reminderTag: config.reminderTag.trim() || '思考节拍',
    };
}
