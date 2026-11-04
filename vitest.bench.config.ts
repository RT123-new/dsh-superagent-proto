import { defineConfig } from 'vitest/config'
// Explicit benchmark suite (`pnpm bench`): deterministic virtual-time measurement workloads, ~95 s, excluded from `pnpm test`.
export default defineConfig({ resolve: { dedupe: ['react', 'react-dom'] }, test: { include: ['bench/**/*.bench.spec.{ts,tsx}'] } })
