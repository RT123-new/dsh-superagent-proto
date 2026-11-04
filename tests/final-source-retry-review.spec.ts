/** Final review (phases 3/4): focused proofs through the real Commands subprocess boundary and retryDecision. */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Commands, commandError } from '../src/infra/commands.ts'
import { classifyError, retryDecision } from '../src/app/retry-policy.ts'
import { testDeployment } from './fixtures/deployment.ts'

function fakeGh(script: string): Commands {
  const dir = mkdtempSync(join(tmpdir(), 'fakegh-')); const cli = join(dir, 'gh')
  writeFileSync(cli, `#!/bin/sh\n${script}\n`); chmodSync(cli, 0o755)
  const d = testDeployment(); return new Commands(() => ({ ...d, github: { ...d.github, cli } }), {}, new AbortController().signal)
}
const failure = (stderr: string) => commandError(Object.assign(new Error('x'), { stderr, code: 1 }), 'gh')
const NOW = Date.parse('2026-09-09T00:00:00Z')

describe('4.1 retryDecision numeric safety', () => {
  it('never yields NaN, negative or infinite delays for invalid inputs', () => {
    const e = Object.assign(new Error('x'), { status: 503 })
    for (const [base, max, rng, now] of [[1000, 60000, () => NaN, NOW], [1000, 60000, () => 0.5, NaN], [NaN, 60000, () => 0.5, NOW], [1000, Infinity, () => 0.5, NOW], [-5, 60000, () => 0.5, NOW], [1000, 60000, () => 7, NOW]] as const) {
      const d = retryDecision(e, 3, base, max, rng, now)
      expect(d.retry).toBe(true)
      if (d.retry) { expect(Number.isFinite(d.delay)).toBe(true); expect(d.delay).toBeGreaterThanOrEqual(0) }
    }
  })
  it('bounds a trusted server instruction (absurd Retry-After must not schedule years ahead)', async () => {
    const { TransportFailure } = await import('../src/infra/transport-failure.ts')
    const d = retryDecision(new TransportFailure('x', { status: 429, retryAfter: '99999999999' }, NOW), 0, 1000, 60000, () => 0.5, NOW)
    expect(d.retry && d.delay).toBeLessThanOrEqual(24 * 3600_000)
  })
})
describe('4.2 actual gh failure pathways', () => {
  it.each([
    ['gh: API rate limit exceeded for user ID 1. (HTTP 403)', 'rate_limited'],
    ['gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)', 'rate_limited'],
    ['gh: Resource not accessible by personal access token (HTTP 403)', 'unauthorized'],
    ['gh: Bad credentials (HTTP 401)', 'unauthorized'],
    ['gh: Too Many Requests (HTTP 429)', 'rate_limited'],
    ['gh: Request Timeout (HTTP 408)', 'provider_temporary'],
    ['gh: Service Unavailable (HTTP 503)', 'provider_temporary'],
    ['error connecting to api.github.com: dial tcp: lookup api.github.com: no such host', 'transient'],
  ])('%s -> %s', (stderr, kind) => { expect(classifyError(failure(stderr))).toBe(kind) })
})
describe('3.2 large and malformed gh output through a real subprocess', () => {
  it('a >16 MiB paginated history fails with a retryable-looking class (documents repeated non-progress)', async () => {
    const commands = fakeGh(`head -c 17000000 /dev/zero | tr '\\0' 'a'`)
    const error = await commands.api('issues').then(() => undefined, (e: unknown) => e)
    expect(String(error)).toMatch(/more output/)
    // Must be distinguishable from a transient failure so it is not retried forever.
    expect(classifyError(error)).not.toBe('transient')
  })
  it('truncated JSON from gh is classified as an unreadable response, not a permanent programming error', async () => {
    const commands = fakeGh(`printf '[[{"id":1},'`)
    const error = await commands.pages(await import('zod').then(z => z.z.unknown()), 'issues').then(() => undefined, (e: unknown) => e)
    expect(error).toBeDefined()
    expect(classifyError(error)).not.toBe('programming_error')
  })
})
