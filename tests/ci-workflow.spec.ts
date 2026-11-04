/** The CI workflow's failure propagation: a masked canonical green was observed live (run 41835601528). */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/validate.yml', import.meta.url), 'utf8')

describe('validate.yml', () => {
  it('pins the explicit bash shell contract so pipefail applies (unspecified shells run bash -e without it)', () => {
    expect(workflow).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell: bash/)
  })
  it('propagates the canonical test result through the evidence tee instead of returning tee\'s exit status', () => {
    expect(workflow).toContain('pnpm test 2>&1 | tee test-output.txt; exit ${PIPESTATUS[0]}')
  })
  it('records the tested SHA after checkout, whose clean wipes untracked files', () => {
    expect(workflow.indexOf('uses: actions/checkout@v4')).toBeLessThan(workflow.indexOf('tee tested-sha.txt'))
  })
})
