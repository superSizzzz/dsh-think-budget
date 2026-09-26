#!/usr/bin/env node
/**
 * 把这份 checkout 的依赖解析接到 dsh 自己的依赖目录上。
 *
 * 插件不自己装 `@deepseek-ai/*` —— 那些包由 dsh 提供，package.json 里只
 * 声明 peerDependencies。但 Node 解析 `import '@deepseek-ai/dsh-llm'` 时
 * 需要一个能落地的 node_modules，而 dsh 的 profile 目录下正好有一份完整
 * 的。这个脚本把它链过来，clone 完跑一次即可。
 *
 *   node scripts/link-deps.mjs
 *
 * Windows 上建的是 junction（不需要管理员权限，也不占额外磁盘）；其他
 * 平台建目录符号链接。
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LINK = join(REPO, 'node_modules')
const PROBE = join('@deepseek-ai', 'cordis')

/** dsh 的家目录：优先环境变量，否则 ~/.dsh —— 跟 dsh 自己的解析顺序一致。 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

const source = join(dshHome(), 'profiles', 'node_modules')

if (existsSync(join(LINK, PROBE))) {
  console.log(`✓ node_modules 已可用，能解析 ${PROBE.replace('@deepseek-ai', '@deepseek-ai')}`)
  console.log(`  插件可以直接加载：file:///${join(REPO, 'src', 'index.ts').replace(/\\/g, '/')}`)
  process.exit(0)
}

if (!existsSync(source)) {
  console.error(`✗ 找不到 dsh 的依赖目录：${source}`)
  console.error('  dsh 至少启动过一次才会生成它。装好 dsh 并跑一次 `dsh web` 再回来。')
  console.error('  如果 dsh 装在别处，用 DSH_HOME 指过去，例如：')
  console.error('    $env:DSH_HOME = "D:\\somewhere\\.dsh"; node scripts/link-deps.mjs')
  process.exit(1)
}

if (existsSync(LINK)) {
  console.error(`✗ ${LINK} 已经存在，但里面解析不到 ${PROBE}。`)
  console.error('  这通常意味着你在这里手动装过依赖。先删掉它（或改名）再跑本脚本。')
  process.exit(1)
}

mkdirSync(REPO, { recursive: true })

try {
  symlinkSync(source, LINK, process.platform === 'win32' ? 'junction' : 'dir')
} catch (error) {
  console.error(`✗ 建链接失败：${error instanceof Error ? error.message : String(error)}`)
  console.error('  Windows 上建 junction 不需要管理员权限；如果被组策略挡住，')
  console.error(`  可以手动执行：New-Item -ItemType Junction -Path "${LINK}" -Target "${source}"`)
  process.exit(1)
}

console.log(`✓ 已把 node_modules 链到 ${source}`)
console.log(`  插件路径：file:///${join(REPO, 'src', 'index.ts').replace(/\\/g, '/')}`)
console.log('  下一步：把 README 里那段 patch 粘进 ~/.dsh/profiles/web/cordis.patch.yml')
