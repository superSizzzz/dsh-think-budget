/**
 * 账本逻辑的直跑测试 —— 不依赖 harness，不起会话。
 *
 * 判定规则是这个插件的全部智力，也是最容易被改坏的地方：什么算结论、
 * 什么时候该出声、冷却与配额怎么算，全在这里被钉住。
 *
 *   node test/tracker.test.mjs
 */
import { resolveConfig } from '../src/config.ts'
import { ThinkBudgetTracker } from '../src/tracker.ts'

let passed = 0
const failures = []

function check(label, condition) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(label)
}

function equal(label, actual, expected) {
  check(`${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`, actual === expected)
}

/** 一份标准配置，用例里按需覆盖。 */
function config(overrides = {}) {
  return resolveConfig({
    enabled: true,
    maxReasoningCharsPerStep: 1000,
    maxStepsWithoutConclusion: 3,
    minConclusionChars: 12,
    cooldownSteps: 2,
    maxRemindersPerTurn: 5,
    includeSubagents: true,
    systemPromptSection: true,
    downgradeReasoningEffort: '',
    reminderTag: '思考节拍',
    logPath: '',
    ...overrides,
  })
}

function step(tracker, turn, n, reasoningChars, visibleChars, toolCalls = 0) {
  return tracker.observe({ turn, step: n, reasoningChars, visibleChars, toolCalls })
}

// ---------------------------------------------------------------------------
// 1. 有结论就不打扰 —— 哪怕这一步思考很长
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  const verdict = step(tracker, 1, 1, 9000, 40)
  equal('有结论时沉默', verdict, null)
  equal('有结论后 streak 归零', tracker.noConclusionStreak, 0)
}

// ---------------------------------------------------------------------------
// 2. 连续无结论到阈值就出声，并且严格按冷却节奏
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  equal('第 1 步沉默', step(tracker, 1, 1, 300, 0), null)
  equal('第 2 步沉默', step(tracker, 1, 2, 300, 0), null)

  const third = step(tracker, 1, 3, 300, 0)
  check('第 3 步触发', third !== null && third.kind === 'no-conclusion-streak')
  equal('触发时报告 streak', third?.streak, 3)

  equal('第 4 步在冷却窗口内', step(tracker, 1, 4, 300, 0), null)

  const fifth = step(tracker, 1, 5, 300, 0)
  check('第 5 步冷却结束再次触发', fifth !== null && fifth.kind === 'no-conclusion-streak')
  equal('第二次触发时 streak 继续累加', fifth?.streak, 5)
}

// ---------------------------------------------------------------------------
// 3. 单步思考超预算同样是出手理由
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  const verdict = step(tracker, 1, 1, 2500, 0)
  check('思考超预算触发', verdict !== null && verdict.kind === 'reasoning-over-budget')
  equal('超预算报告思考字数', verdict?.reasoningChars, 2500)
}

// 阈值是「超过」而不是「达到」：等于预算不算越界。
{
  const tracker = new ThinkBudgetTracker(config())
  equal('正好等于预算不算越界', step(tracker, 1, 1, 1000, 0), null)
}

// ---------------------------------------------------------------------------
// 4. 关掉某一项就真的不触发
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config({ maxReasoningCharsPerStep: 0 }))
  equal('预算关掉后长思考不再提醒', step(tracker, 1, 1, 99999, 0), null)
}
{
  const tracker = new ThinkBudgetTracker(config({ maxStepsWithoutConclusion: 0 }))
  equal('节拍关掉后连续无结论不提醒', step(tracker, 1, 1, 10, 0), null)
  equal('节拍关掉后第 9 步仍不提醒', step(tracker, 1, 9, 10, 0), null)
}

// ---------------------------------------------------------------------------
// 5. 每轮配额封顶
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config({ maxRemindersPerTurn: 2 }))
  const first = step(tracker, 1, 1, 5000, 0)
  check('第 1 步用掉第 1 条额度', first !== null && first.kind === 'reasoning-over-budget')
  equal('第 2 步在冷却窗口内', step(tracker, 1, 2, 5000, 0), null)
  check('第 3 步用掉第 2 条额度', step(tracker, 1, 3, 5000, 0) !== null)
  equal('配额用完后闭嘴', step(tracker, 1, 5, 5000, 0), null)
  equal('配额用完后仍然闭嘴', step(tracker, 1, 20, 5000, 0), null)
  equal('配额计数只增不减', tracker.reminders, 2)
}

// ---------------------------------------------------------------------------
// 6. 新一轮用户输入 = 新账本
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  step(tracker, 1, 1, 300, 0)
  step(tracker, 1, 2, 300, 0)
  step(tracker, 1, 3, 300, 0)
  equal('第 1 轮已累到 3', tracker.noConclusionStreak, 3)
  check('第 1 轮已出声', tracker.reminders > 0)

  equal('第 2 轮第 1 步沉默', step(tracker, 2, 1, 300, 0), null)
  equal('第 2 轮 streak 从头算', tracker.noConclusionStreak, 1)
  equal('第 2 轮配额重置', tracker.reminders, 0)
  equal('第 2 轮 turn 已更新', tracker.currentTurn, 2)
}

// ---------------------------------------------------------------------------
// 7. 同一步被重复结算不重复计分
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  step(tracker, 1, 1, 300, 0)
  step(tracker, 1, 1, 300, 0)
  equal('重复结算同一步只记一次', tracker.noConclusionStreak, 1)
}

// ---------------------------------------------------------------------------
// 8. 正文门槛：短过渡语不算结论
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  equal('「让我看看」不算结论', step(tracker, 1, 1, 300, 4), null)
  equal('不算结论则继续累加 streak', tracker.noConclusionStreak, 1)
  step(tracker, 1, 2, 300, 4)
  step(tracker, 1, 3, 300, 4)
  equal('短过渡语攒够了也会触发', tracker.noConclusionStreak, 3)
}

// ---------------------------------------------------------------------------
// 9. 降档信号：只在真的陷进去时给
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config({ downgradeReasoningEffort: 'low' }))
  equal('还没陷进去时不降档', tracker.shouldDowngrade(), false)
  step(tracker, 1, 1, 100, 0)
  step(tracker, 1, 2, 100, 0)
  equal('两步时还不降档', tracker.shouldDowngrade(), false)
  step(tracker, 1, 3, 100, 0)
  equal('到阈值才降档', tracker.shouldDowngrade(), true)
  step(tracker, 1, 4, 100, 60)
  equal('写出结论后撤销降档', tracker.shouldDowngrade(), false)
}
{
  const tracker = new ThinkBudgetTracker(config())
  step(tracker, 1, 1, 100, 0)
  step(tracker, 1, 2, 100, 0)
  step(tracker, 1, 3, 100, 0)
  equal('没配降档值就永不降档', tracker.shouldDowngrade(), false)
}

// ---------------------------------------------------------------------------
// 10. reset() 清干净，之后从头重新累
// ---------------------------------------------------------------------------
{
  const tracker = new ThinkBudgetTracker(config())
  step(tracker, 1, 1, 300, 0)
  step(tracker, 1, 2, 300, 0)
  step(tracker, 1, 3, 300, 0)
  tracker.reset()
  equal('reset 清 streak', tracker.noConclusionStreak, 0)
  equal('reset 清配额', tracker.reminders, 0)
  equal('reset 后第 1 步沉默', step(tracker, 1, 1, 300, 0), null)
  step(tracker, 1, 2, 300, 0)
  check('reset 后重新累到阈值才触发', step(tracker, 1, 3, 300, 0) !== null)
}

// ---------------------------------------------------------------------------
// 11. 归一化：负数、小数、空白都会被收干净
// ---------------------------------------------------------------------------
{
  const resolved = config({ maxStepsWithoutConclusion: -5, cooldownSteps: 1.7, downgradeReasoningEffort: '  low  ' })
  equal('负数阈值折成关闭', resolved.maxStepsWithoutConclusion, 0)
  equal('小数向下取整', resolved.cooldownSteps, 1)
  equal('降档值去空白', resolved.downgradeReasoningEffort, 'low')
}

console.log(failures.length === 0
  ? `全部通过：${passed} 项断言`
  : `失败 ${failures.length} 项：\n${failures.map((line) => `  - ${line}`).join('\n')}`)

process.exit(failures.length === 0 ? 0 : 1)
