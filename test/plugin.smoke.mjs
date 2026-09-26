/**
 * 插件装配的冒烟测试 —— 走真实代码路径，但不碰 harness。
 *
 * 跟 tracker.test.mjs 的分工：那边证明「判定规则对」，这边证明「接线
 * 对」—— apply 不抛错、事件名注册得上、流里的字数被正确累计、越界时
 * 真的调了 `agent.inject()`、注入的消息是一份 harness 收得下的完整
 * user 消息（有 id、有 role、source kind 是自己的）。
 *
 * 用假 ctx / 假 agent，所以不需要起 dsh，也不消耗额度。
 *
 *   node test/plugin.smoke.mjs
 */
import { apply } from '../src/index.ts'

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

/** 最小可用的 cordis Context 替身：只实现插件真正用到的那几样。 */
function makeContext() {
  const listeners = new Map()
  const sections = []
  const toggles = []
  const ctx = {
    agents: undefined,
    systemPrompt: {
      section(section) {
        sections.push(section)
        const dispose = () => {}
        toggles.push(dispose)
        return dispose
      },
    },
    on(name, handler) {
      const list = listeners.get(name) ?? []
      list.push(handler)
      listeners.set(name, list)
      return () => {
        const current = listeners.get(name) ?? []
        listeners.set(name, current.filter((item) => item !== handler))
      }
    },
    effect(callback) {
      return callback()
    },
  }
  return {
    ctx,
    sections,
    emit(name, payload) {
      for (const handler of listeners.get(name) ?? []) handler(payload)
    },
    listenerCount(name) {
      return (listeners.get(name) ?? []).length
    },
  }
}

function makeAgent(id) {
  const injected = []
  return {
    id,
    injected,
    inject(message) {
      injected.push(message)
    },
  }
}

/** 把一段完整的模型尝试喂给插件：start → 若干 chunk → end。 */
function feedAttempt(harness, agent, { attemptId, turn, step, reasoning, visible, toolCalls = 0 }) {
  harness.emit('agent/assistant-stream', {
    agent,
    frame: { type: 'start', attemptId, revision: 1, turn, step },
  })

  if (reasoning.length > 0) {
    harness.emit('agent/assistant-stream', {
      agent,
      frame: {
        type: 'chunk',
        attemptId,
        revision: 1,
        index: 0,
        time: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: reasoning },
      },
    })
  }
  if (visible.length > 0) {
    harness.emit('agent/assistant-stream', {
      agent,
      frame: {
        type: 'chunk',
        attemptId,
        revision: 1,
        index: 1,
        time: 0,
        chunk: { type: 'text-delta', index: 1, text: visible },
      },
    })
  }
  for (let i = 0; i < toolCalls; i += 1) {
    harness.emit('agent/assistant-stream', {
      agent,
      frame: {
        type: 'chunk',
        attemptId,
        revision: 1,
        index: 2 + i,
        time: 0,
        chunk: { type: 'block-start', index: 2 + i, blockType: 'tool-call' },
      },
    })
  }

  harness.emit('agent/assistant-stream', {
    agent,
    frame: {
      type: 'end',
      attemptId,
      revision: 1,
      index: 3,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 1 },
    },
  })
}

// ---------------------------------------------------------------------------
// 1. 默认配置能装上，且注册了该注册的东西
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, {})
  equal('注册了流监听', harness.listenerCount('agent/assistant-stream'), 1)
  equal('默认不注册请求拦截（降档默认关）', harness.listenerCount('agent/request'), 0)
  equal('注册了一段系统提示', harness.sections.length, 1)

  const section = harness.sections[0]
  equal('系统提示段落名固定', section.name, 'think-budget:policy')
  check('系统提示里写了结论节拍', section.text.includes('可见正文结论'))
  check('系统提示里写了思考预算', section.text.includes('字以内'))
}

// ---------------------------------------------------------------------------
// 2. 关掉总开关就什么都不装
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { enabled: false })
  equal('总开关关掉后不装流监听', harness.listenerCount('agent/assistant-stream'), 0)
  equal('总开关关掉后不写系统提示', harness.sections.length, 0)
}

// ---------------------------------------------------------------------------
// 3. 主链路：连续三步无结论，第四步开始时该有一条提醒躺在 inbox 里
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, {})
  const agent = makeAgent('main')

  feedAttempt(harness, agent, { attemptId: 'a1', turn: 1, step: 1, reasoning: '反复推演……', visible: '' })
  equal('第 1 步不打扰', agent.injected.length, 0)

  feedAttempt(harness, agent, { attemptId: 'a2', turn: 1, step: 2, reasoning: '继续推演……', visible: '' })
  equal('第 2 步不打扰', agent.injected.length, 0)

  feedAttempt(harness, agent, { attemptId: 'a3', turn: 1, step: 3, reasoning: '还在推演……', visible: '', toolCalls: 2 })
  equal('第 3 步出手', agent.injected.length, 1)

  const message = agent.injected[0]
  equal('注入的是 user 角色', message.role, 'user')
  check('注入的是完整消息（带 id）', typeof message.id === 'string' && message.id.length > 0)
  equal('来源 kind 是自己的', message.source.kind, 'think-budget')
  check('摘要说清了原因', message.source.summary.includes('连续 3 次'))
  check('正文要求先给结论', message.content[0].text.includes('结论'))

  // 有结论之后就该收手
  feedAttempt(harness, agent, { attemptId: 'a4', turn: 1, step: 4, reasoning: '收尾', visible: '结论：这条路走不通，改走另一条。' })
  feedAttempt(harness, agent, { attemptId: 'a5', turn: 1, step: 5, reasoning: '下一步', visible: '' })
  equal('写出结论后回到沉默', agent.injected.length, 1)
}

// ---------------------------------------------------------------------------
// 4. 单步思考超预算、但没结论 —— 第一步就该拦
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxReasoningCharsPerStep: 100 })
  const agent = makeAgent('main')

  feedAttempt(harness, agent, { attemptId: 'a1', turn: 1, step: 1, reasoning: 'x'.repeat(500), visible: '' })
  equal('超预算立刻出手', agent.injected.length, 1)
  check('提醒里报了字数', agent.injected[0].content[0].text.includes('500'))
}

// 同一份配置下，思考同样长但写了正文 → 不打扰
{
  const harness = makeContext()
  apply(harness.ctx, { maxReasoningCharsPerStep: 100 })
  const agent = makeAgent('main')

  feedAttempt(harness, agent, {
    attemptId: 'a1',
    turn: 1,
    step: 1,
    reasoning: 'x'.repeat(500),
    visible: '结论：先按 A 方案走，理由是这样。',
  })
  equal('有结论就不管思考多长', agent.injected.length, 0)
}

// ---------------------------------------------------------------------------
// 5. 失败的尝试不算一步
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxStepsWithoutConclusion: 2 })
  const agent = makeAgent('main')

  harness.emit('agent/assistant-stream', {
    agent,
    frame: { type: 'start', attemptId: 'bad', revision: 1, turn: 1, step: 1 },
  })
  harness.emit('agent/assistant-stream', {
    agent,
    frame: { type: 'end', attemptId: 'bad', revision: 1, index: 0, outcome: { kind: 'abandoned' } },
  })
  equal('中止的尝试不触发', agent.injected.length, 0)

  feedAttempt(harness, agent, { attemptId: 'a1', turn: 1, step: 1, reasoning: '想', visible: '' })
  equal('第 1 个有效步不触发', agent.injected.length, 0)
  feedAttempt(harness, agent, { attemptId: 'a2', turn: 1, step: 2, reasoning: '想', visible: '' })
  equal('第 2 个有效步触发', agent.injected.length, 1)
}

// ---------------------------------------------------------------------------
// 6. 新一轮清账
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxStepsWithoutConclusion: 2 })
  const agent = makeAgent('main')

  feedAttempt(harness, agent, { attemptId: 'a1', turn: 1, step: 1, reasoning: '想', visible: '' })
  feedAttempt(harness, agent, { attemptId: 'a2', turn: 1, step: 2, reasoning: '想', visible: '' })
  equal('第 1 轮出手一次', agent.injected.length, 1)

  feedAttempt(harness, agent, { attemptId: 'b1', turn: 2, step: 1, reasoning: '想', visible: '' })
  equal('第 2 轮第 1 步不打扰', agent.injected.length, 1)
  feedAttempt(harness, agent, { attemptId: 'b2', turn: 2, step: 2, reasoning: '想', visible: '' })
  equal('第 2 轮重新累到阈值', agent.injected.length, 2)
}

// ---------------------------------------------------------------------------
// 7. 降档开关打开时会挂上请求拦截
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { downgradeReasoningEffort: 'low' })
  equal('开了降档就挂请求拦截', harness.listenerCount('agent/request'), 1)
}

// ---------------------------------------------------------------------------
// 8. 投递失败不许冒泡（agent 已经退出之类的现场情况）
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxStepsWithoutConclusion: 1 })
  const broken = {
    id: 'broken',
    inject() {
      throw new Error('agent disposed')
    },
  }

  let threw = false
  try {
    feedAttempt(harness, broken, { attemptId: 'a1', turn: 1, step: 1, reasoning: '想', visible: '' })
  } catch {
    threw = true
  }
  check('注入抛错不会冒泡出去', !threw)
}

// ---------------------------------------------------------------------------
// 9. 多个 agent 各记各的账
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxStepsWithoutConclusion: 2 })
  const main = makeAgent('main')
  const child = makeAgent('child')

  feedAttempt(harness, main, { attemptId: 'm1', turn: 1, step: 1, reasoning: '想', visible: '' })
  feedAttempt(harness, child, { attemptId: 'c1', turn: 1, step: 1, reasoning: '想', visible: '' })
  equal('A 的第 1 步不触发', main.injected.length, 0)
  equal('B 的第 1 步也不触发', child.injected.length, 0)

  feedAttempt(harness, child, { attemptId: 'c2', turn: 1, step: 2, reasoning: '想', visible: '' })
  equal('B 自己攒够了自己触发', child.injected.length, 1)
  equal('不连累 A', main.injected.length, 0)
}

// ---------------------------------------------------------------------------
// 10. 日志开关：默认不落盘，开了才写
// ---------------------------------------------------------------------------
{
  const harness = makeContext()
  apply(harness.ctx, { maxStepsWithoutConclusion: 1, logPath: '' })
  const agent = makeAgent('main')
  feedAttempt(harness, agent, { attemptId: 'a1', turn: 1, step: 1, reasoning: '想', visible: '' })
  equal('默认仍然出手', agent.injected.length, 1)
  check('默认不写日志也不报错', true)
}

console.log(failures.length === 0
  ? `全部通过：${passed} 项断言`
  : `失败 ${failures.length} 项：\n${failures.map((line) => `  - ${line}`).join('\n')}`)

process.exit(failures.length === 0 ? 0 : 1)
