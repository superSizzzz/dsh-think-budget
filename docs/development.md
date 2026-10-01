# 开发与测试

[← 回 README](../README.md)

## 两种加载方式

同一个仓库同时服务两种装法，用的是同一份源码：

| 装法 | 加载的是 | 构建 | 适合 |
|---|---|---|---|
| `dsh plugin add`（包名） | `lib/index.js` 编译产物 | 需要产物 | 普通使用 |
| 源码 checkout（`file://`） | `src/index.ts` 源码 | 零构建 | 改代码 |

为什么不能拿源码走包名：`dsh plugin add` 装出来的包一定落在 `node_modules` 下，而 Node
的类型擦除明确拒绝那里的 `.ts`：

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
```

所以凡走包名加载的插件都必须提供 `.js`。产物随仓库提交，安装端因此不需要 TypeScript。

## 源码 checkout 装法

想改代码就用这个 —— 没有构建步骤，保存即热重载。

```powershell
# 1) clone
git clone https://github.com/superSizzzz/dsh-think-budget.git D:\plugins\dsh-think-budget

# 2) 接依赖，并打印一份路径已填好的 patch 片段
cd D:\plugins\dsh-think-budget
node scripts/link-deps.mjs --patch

# 3) 把打印出来的 - insert: 段追加到补丁文件末尾
```

补丁文件决定管多大范围：

| 文件 | 作用范围 |
|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` | 只管 web profile |
| `~/.dsh/cordis.patch.yml` | home 层，对所有 profile 生效 |

插件不自己装依赖 —— `@deepseek-ai/*` 由 dsh 提供，仓库里只声明 peerDependencies。
`link-deps.mjs` 建的 node_modules junction 就是为这个（不做这步，`import
'@deepseek-ai/dsh-llm'` 会失败）。

想先试一次、不碰任何 profile 文件，仓库里备了一份现成的补丁层：

```powershell
dsh web --patch <plugin-dir>/cordis.think-budget.yml
```

**两种装法二选一，不要同时用** —— 挂出来的补丁条目 id 相同，同时存在会让插件被加载
两次，每条提醒发两遍。

## 构建

```powershell
node scripts/link-deps.mjs   # 首次 clone 后接一次依赖
npm run typecheck            # 只做类型检查，不产出
npm run build                # 重建 lib/
npm test                     # 跑测试
```

`tsconfig.json` 开了 `rewriteRelativeImportExtensions`：源码里的相对导入必须带 `.ts`
扩展名（类型擦除的要求），编译时会被改写成 `.js`，一份源码同时服务两种加载方式。

同样因为类型擦除，源码里要避开需要转译的语法：`enum`、参数属性、装饰器。

**改了 `src/` 记得跑一次 `npm run build` 并提交 `lib/`** —— 否则 `dsh plugin add` 装出来
的还是旧产物。

## 测试

两个测试都是直跑，不需要起 dsh、不花额度：

```powershell
npm test                            # 两个一起跑
node test/tracker.test.mjs          # 43 项断言
node test/plugin.smoke.mjs          # 34 项断言
```

`tracker.test.mjs` 钉的是智力：什么算结论、什么时候出声、冷却和配额怎么算、新一轮怎么
清账、关掉的项真的不触发。

`plugin.smoke.mjs` 钉的是接线：`apply` 不抛错、事件名注册得上、流里的字数被正确累计、
越界时真的调了 `agent.inject()`、注入的是一份 harness 收得下的完整 user 消息。用的是假
ctx 和假 agent。

### 再验一层装载

想确认「dsh 的 loader 到底认不认它」，起一个不占 3080 的隔离实例：

```powershell
dsh --profile web --patch <plugin-dir>\test\verify-load.yml --port 3199 --no-open
```

`verify-load.yml` 会先把飞书桥关掉（验证过程不该往真实飞书发消息），再把装载留痕写进
`test/.verify-applied.jsonl`。文件里出现 `"event":"applied"` 的行，就说明 loader 解析了
`file://` 路径、import 了模块、校过 config、调到了 `apply`。验证完把那个实例关掉即可。
