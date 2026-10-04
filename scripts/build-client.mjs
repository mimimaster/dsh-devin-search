import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const entryFile = resolve(projectRoot, 'src/client/index.ts')
const distDir = resolve(projectRoot, 'dist')
const outFile = resolve(distDir, 'client.js')

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

const banner = `window.__ModuleLoader__.load({ id: "dsh-devin-search", factory: function(require) {
var module = { exports: {} }; var exports = module.exports;`

const footer = `return module.exports; } });`

// Externals that DSH module loader provides in the browser
const externals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-conversation',
]

const externalArgs = externals.map(e => `--external:${e}`).join(' ')

const cmd = `npx --no-install esbuild "${entryFile}" --bundle --format=cjs --platform=browser --target=es2022 --jsx=automatic ${externalArgs} --outfile="${outFile}"`

console.log('Running esbuild...')
execSync(cmd, { stdio: 'inherit', cwd: projectRoot })

// Wrap with __ModuleLoader__.load banner and footer
const code = readFileSync(outFile, 'utf8')
const wrapped = `${banner}\n${code}\n${footer}\n`
writeFileSync(outFile, wrapped, 'utf8')

// Emit client.d.ts
const dtsFile = resolve(distDir, 'client.d.ts')
const dtsContent = `import type { Context } from '@deepseek-ai/cordis'

export declare const name: string
export declare const inject: readonly string[]
export declare function apply(ctx: Context): void
`
writeFileSync(dtsFile, dtsContent, 'utf8')

console.log(`Successfully generated ${outFile} and ${dtsFile}`)
