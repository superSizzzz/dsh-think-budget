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
import type { ResolvedConfig } from './config.ts';
import type { Verdict } from './tracker.ts';
/** 提醒正文：模型在历史里读到的就是这段。 */
export declare function reminderText(verdict: Verdict, config: ResolvedConfig): string;
/** 一行摘要，用于注入消息的来源归属（UI 上折叠时显示）。 */
export declare function reminderSummary(verdict: Verdict): string;
/**
 * 系统提示里的「思考节拍」段落 —— 预防层。
 *
 * 事后提醒是补救，写进提示词才是让模型一开始就配合。两项预算都被
 * 关掉时返回空串，调用方据此跳过注册（不留一段没约束力的废话）。
 */
export declare function systemSectionText(config: ResolvedConfig): string;
