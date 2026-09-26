import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
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
        'think-budget': {
            kind: 'think-budget';
            form: 'notice';
            summary: string;
        };
    }
}
export declare const name = "think-budget";
/** 全部走软取：缺哪个服务就少一路能力，不让插件本身加载失败。 */
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, rawConfig: unknown): void;
