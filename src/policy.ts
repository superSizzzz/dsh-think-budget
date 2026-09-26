/**
 * 文案层 —— 所有对模型说的话都在这里，跟机制分开。
 *
 * 两点讲究：
 *
 * 1. **对模型说话不用「步」「step」**：模型看不到自己的步骤号，它只
 *    知道「我上一次回复」。文案按它的视角写，指代才落得下去。
 * 2. **给退路**：允许「还不确定」这种结论。只逼「必须写点什么」、
 *    不逼「必须想明白」，模型才不会为了凑结论而编一个假答案 ——
 *    这是这个插件最容易帮倒忙的地方，文案上要堵住。
 */
import type { ResolvedConfig } from './config.ts'
import type { Verdict } from './tracker.ts'

/** `notice` 摘要的上限由 harness 定为 120 字符，这里再收紧一档。 */
const SUMMARY_MAX = 100

/** 提醒正文：模型在历史里读到的就是这段。 */
export function reminderText(verdict: Verdict, config: ResolvedConfig): string {
  const tag = config.reminderTag
  if (verdict.kind === 'no-conclusion-streak') {
    return [
      `【${tag}】你最近连续 ${verdict.streak} 次回复都没有写正文，只有思考和工具调用。`,
      '现在请立即用正文写出你目前的结论 —— 可以很短、可以不完整、可以是「还不确定，因为…」，但必须写出来。',
      '写完之后如果还需要继续，再继续调用工具。',
    ].join('\n')
  }

  return [
    `【${tag}】你这一次回复里思考了约 ${verdict.reasoningChars} 字，却没有写正文。`,
    '请先用一句话写出当前判断（哪怕是阶段性的），再继续思考和调用工具。',
    '一件事推演到能下判断就够了，不要反复重推同一个问题。',
  ].join('\n')
}

/** 一行摘要，用于注入消息的来源归属（UI 上折叠时显示）。 */
export function reminderSummary(verdict: Verdict): string {
  const text = verdict.kind === 'no-conclusion-streak'
    ? `连续 ${verdict.streak} 次回复无正文`
    : `单次思考约 ${verdict.reasoningChars} 字超预算`
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

/**
 * 系统提示里的「思考节拍」段落 —— 预防层。
 *
 * 事后提醒是补救，写进提示词才是让模型一开始就配合。两项预算都被
 * 关掉时返回空串，调用方据此跳过注册（不留一段没约束力的废话）。
 */
export function systemSectionText(config: ResolvedConfig): string {
  const lines: string[] = [
    '## 思考节拍',
    '',
    '- 思考（reasoning）是内部草稿，用户看不到；正文才是交付物。不要把结论留在思考里。',
  ]

  if (config.maxStepsWithoutConclusion > 0) {
    lines.push(`- 每 ${config.maxStepsWithoutConclusion} 次回复之内，至少写一次可见正文结论 —— 阶段判断也算，「目前还不确定，因为…」也算。`)
  }

  if (config.maxReasoningCharsPerStep > 0) {
    lines.push(`- 单次思考控制在约 ${config.maxReasoningCharsPerStep} 字以内。一件事推演到能下判断就够了，不要反复重推同一个问题。`)
  }

  lines.push('- 先给结论，再继续调用工具；需要长任务时，用阶段结论代替沉默。')

  return lines.join('\n')
}
