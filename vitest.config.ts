import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: {
  '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./test/native-primitives.ts', import.meta.url)),
} } });
