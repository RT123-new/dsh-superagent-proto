import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['scripts/stage-d/experiments.spec.ts'] } })
