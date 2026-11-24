import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['scripts/ui-preview/export-fixtures.spec.ts'] } })
