import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/extension.js');

await build({
  absWorkingDir: root,
  entryPoints: ['src/extension.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  external: [
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-tui',
    'typebox',
    'ignore',
  ],
});

const bundled = readFileSync(outfile, 'utf8');
const leaked = ['@deepseek-ai', 'cordis', 'dsh-credentials', 'from "react"', "from 'react'"];
for (const marker of leaked) {
  if (bundled.includes(marker)) throw new Error(`DSH or desktop runtime leaked into ${outfile}: ${marker}`);
}
if (!bundled.includes('from "ignore"') && !bundled.includes("from 'ignore'")) {
  throw new Error('ignore must stay external');
}
if (!bundled.includes('@earendil-works/pi-coding-agent')) {
  throw new Error('pi SDK import must stay external');
}
