/** Final review (phases 3/4): focused proofs through the real Commands subprocess boundary and retryDecision. */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Commands, commandError, validItems } from '../src/infra/commands.ts'
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
  it('fails closed on an unrepresentable trusted embargo and never dispatches before a representable one', async () => {
    const { TransportFailure } = await import('../src/infra/transport-failure.ts')
    const d = retryDecision(new TransportFailure('x', { status: 429, retryAfter: '99999999999' }, NOW), 0, 1000, 60000, () => 0.5, NOW)
    expect(d.retry).toBe(false)
    const ok = retryDecision(new TransportFailure('x', { status: 429, retryAfter: '7200' }, NOW), 0, 1000, 60000, () => 0.5, NOW)
    expect(ok.retry && ok.delay).toBeGreaterThanOrEqual(7200_000)
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
describe('4.2 hostile 403 text must not become retryable', () => {
  it.each([
    'gh: Resource not accessible by integration: cannot read branch "rate limit-fix" (HTTP 403)',
    'gh: Repository rule violations found: branch name abuse detection not allowed (HTTP 403)',
    'gh: Forbidden: your API rate limit exceeded policy is not set (HTTP 403)',
  ])('%s -> unauthorized', stderr => { expect(classifyError(failure(stderr))).toBe('unauthorized') })
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

describe('3.2 oversized slurp falls back to bounded pages', () => {
  it('reads 250 items page by page when --paginate --slurp exceeds the output cap, without losing or duplicating any', async () => {
    const commands = fakeGh(`exec node -e '
const a = process.argv.slice(1).join(" ")
if (a.includes("--slurp")) process.stdout.write("a".repeat(17000000))
else {
const page = Number(/[?&]page=(\\d+)/.exec(a)[1]); const out = []
for (let i = (page - 1) * 100 + 1; i <= Math.min(250, page * 100); i++) out.push({ id: i })
console.log(JSON.stringify(out)) }' -- "$@"`)
    const z = (await import('zod')).z
    const items = await commands.pages(z.looseObject({ id: z.number() }), 'issues?per_page=100')
    expect(items.map(i => i.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1))
  })
  it('continues from the caller-requested start page instead of re-reading page 1', async () => {
    const commands = fakeGh(`exec node -e '
const a = process.argv.slice(1).join(" ")
if (a.includes("--slurp")) process.stdout.write("a".repeat(17000000))
else { const page = Number(/[?&]page=(\\d+)/.exec(a)[1]); const out = []
for (let i = (page - 1) * 100 + 1; i <= Math.min(250, page * 100); i++) out.push({ id: i })
console.log(JSON.stringify(out)) }' -- "$@"`)
    const z = (await import('zod')).z
    const items = await commands.pages(z.looseObject({ id: z.number() }), 'issues?per_page=100&page=2')
    expect(items.map(i => i.id)).toEqual(Array.from({ length: 150 }, (_, i) => i + 101))
  })
  it('still refuses a path outside the repository on the fallback route', async () => {
    const commands = fakeGh('true')
    await expect(commands.pages((await import('zod')).z.unknown(), '../../orgs/x')).rejects.toThrow()
  })
})

describe('3.2 check-runs call has no bounded-page fallback', () => {
  it('CHARACTERIZATION: an oversized check-runs slurp fails visibly as a permanent error (not retried as transient, not silently empty)', async () => {
    const commands = fakeGh(`exec node -e 'process.stdout.write("a".repeat(17000000))' -- "$@"`)
    const { pullChecks } = await import('../src/sources/github-read.ts')
    const error = await pullChecks(commands, 'abc123').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as { oversized?: boolean }).oversized).toBe(true)
    expect(classifyError(error)).toBe('permanent')
  })
})

describe('3.4 diagnostics never carry remote text', () => {
  it('reports remote-supplied object keys as ? and arbitrary string ids only as a hash', async () => {
    const { z } = await import('zod')
    const schema = z.object({ id: z.number(), meta: z.record(z.string(), z.number()) })
    const t = { skipped: 0 } as { skipped: number; rejected?: { id?: string | number; fields: string[] }[] }
    validItems(schema, [{ id: 'sk-live-123456', meta: { 'api_key_sk-live-123': 'x' } }], t)
    expect(JSON.stringify(t)).not.toMatch(/sk-live|api_key/)
    expect(t.rejected![0]!.fields).toContain('?.?')
  })
  it('a user-less comment is attributed to the ghost actor and is no more authorised than a null-user comment', async () => {
    const { CommentSchema, commentTrigger } = await import('../src/sources/github-trigger.ts')
    const ref = { number: 1 } as never
    const none = commentTrigger(CommentSchema.parse({ id: 1, body: 'x' }), ref, 'conversation', 'agent-bot')
    const nul = commentTrigger(CommentSchema.parse({ id: 1, body: 'x', user: null }), ref, 'conversation', 'agent-bot')
    expect(none.actor).toEqual(nul.actor)
    expect(none.actor.id).toBe('ghost')
  })
})
describe('3.4 malformed remote items', () => {
  it('records a bounded, redacted diagnostic (id and field names, never values) for a skipped item', async () => {
    const { z } = await import('zod'); const { CommentSchema } = await import('../src/sources/github-trigger.ts')
    const tally = { skipped: 0 } as { skipped: number; rejected?: { id?: string | number; fields: string[] }[] }
    const secret = 'ghp_SECRETSECRETSECRET'
    const list = [{ id: 1, user: { login: 'a' } }, { id: 2, user: { login: 'b' }, body: { nested: secret } }, { id: 3, body: 7, created_at: secret }, ...Array.from({ length: 50 }, (_, i) => ({ id: 100 + i, body: 1 }))]
    expect(validItems(CommentSchema, list, tally).map(i => i.id)).toEqual([1])
    expect(tally.skipped).toBe(52)
    expect(tally.rejected!.length).toBe(20)
    expect(tally.rejected![0]).toEqual({ id: 2, fields: ['body'] })
    const hostile = [{ id: 'ghp_SECRETSECRETSECRET\u001b[31m', body: { 'tok\nen=ghp_X': 1 }, user: 5 }]
    const t2 = { skipped: 0 } as { skipped: number; rejected?: { id?: string | number; fields: string[] }[] }
    validItems(CommentSchema, hostile, t2)
    expect(JSON.stringify(t2)).not.toMatch(/ghp_|tok|\\u001b/)
    expect(t2.rejected![0]!.id).toMatch(/^sha256:[0-9a-f]{12}$/)
    expect(JSON.stringify(tally)).not.toContain(secret)
    void z
  })
  it('a comment lacking the user key is read as the ghost user, not silently dropped', async () => {
    const { CommentSchema } = await import('../src/sources/github-trigger.ts')
    const tally = { skipped: 0 }
    const [read] = validItems(CommentSchema, [{ id: 9, body: 'actionable' }], tally)
    expect(read?.user.login).toBe('ghost')
    expect(tally.skipped).toBe(0)
  })
})

describe('4.3 polling loop backs off under a rate limit', () => {
  it('keeps the interval for other failures and grows (bounded, jittered) for rate-limited ones', async () => {
    const { pollPauseSeconds } = await import('../src/sources/github.ts')
    const limited = failure('gh: API rate limit exceeded for user ID 1. (HTTP 403)')
    expect(pollPauseSeconds(60, 3, failure('gh: Service Unavailable (HTTP 503)'))).toBe(60)
    expect(pollPauseSeconds(60, 0, undefined)).toBe(60)
    const waits = [1, 2, 3, 4, 8, 40].map(n => pollPauseSeconds(60, n, limited, () => 1))
    expect(waits).toEqual([60, 120, 240, 480, 3600, 3600])
    for (const w of waits) expect(w).toBeLessThanOrEqual(3600)
    expect(pollPauseSeconds(60, 3, limited, () => 0)).toBeGreaterThanOrEqual(60)
  })
})

describe('3.4 downstream policy: a user-less comment never gains authorisation', () => {
  it('is not an allowed sender under default settings, addressed or not, and does not differ from a null-user comment', async () => {
    const { SettingsSchema, settingsPolicy } = await import('../src/policy.ts')
    const { SourceRegistry } = await import('../src/sources/registry.ts')
    const { githubKind } = await import('../src/sources/github.ts')
    const { CommentSchema, commentTrigger } = await import('../src/sources/github-trigger.ts')
    const settings = SettingsSchema.parse({})
    const sources = new SourceRegistry(() => settings); sources.register(githubKind)
    const policy = settingsPolicy(settings, sources)
    const ref = { number: 1, isPr: true, url: 'https://github.com/o/r/pull/1' } as never
    const none = { ...commentTrigger(CommentSchema.parse({ id: 1, body: '@agent-bot please fix' }), ref, 'conversation', 'agent-bot'), addressed: 'mention' as const }
    const nul = { ...commentTrigger(CommentSchema.parse({ id: 1, body: '@agent-bot please fix', user: null }), ref, 'conversation', 'agent-bot'), addressed: 'mention' as const }
    const a = policy.gate(none as never, { subscriptions: [] } as never, [] as never), b = policy.gate(nul as never, { subscriptions: [] } as never, [] as never)
    expect(a).toEqual(b)
    expect(a.admissible && a.strength === 'explicit').toBe(false)
  })
})
describe('4.3 poll pause numeric validation', () => {
  it('returns a finite positive interval for any invalid input', async () => {
    const { pollPauseSeconds } = await import('../src/sources/github.ts')
    const limited = failure('gh: API rate limit exceeded for user ID 1. (HTTP 403)')
    for (const [base, failures, rng] of [[NaN, 2, () => 0.5], [Infinity, 2, () => 0.5], [-1, 2, () => 0.5], [60, NaN, () => 0.5], [60, -3, () => 0.5], [60, 1e9, () => 0.5], [60, 3, () => NaN], [60, 3, () => 9]] as const) {
      const w = pollPauseSeconds(base, failures, limited, rng)
      expect(Number.isFinite(w)).toBe(true); expect(w).toBeGreaterThan(0); expect(w).toBeLessThanOrEqual(Math.max(3600, Number.isFinite(base) && base > 0 ? base : 60))
    }
  })
})

describe('4.3 trusted embargo in the poll loop', () => {
  it('waits out a typed 30-day not-before in full and never polls inside it', async () => {
    const { pollPauseSeconds } = await import('../src/sources/github.ts')
    const { TransportFailure } = await import('../src/infra/transport-failure.ts')
    const e = new TransportFailure('x', { status: 429, retryAfter: String(30 * 86400) }, NOW)
    expect(pollPauseSeconds(60, 1, e, () => 0.5, NOW)).toBeGreaterThanOrEqual(30 * 86400)
    const e503 = new TransportFailure('x', { status: 503, retryAfter: '7200' }, NOW)
    expect(pollPauseSeconds(60, 1, e503, () => 0.5, NOW)).toBeGreaterThanOrEqual(7200)
  })
  it('pause() does not fire early for delays beyond the timer limit, and aborts promptly', async () => {
    const { vi } = await import('vitest'); const { pause } = await import('../src/sources/poll.ts')
    vi.useFakeTimers()
    try {
      let done = false; const c = new AbortController()
      void pause(40 * 86400_000, c.signal).then(() => { done = true })
      await vi.advanceTimersByTimeAsync(30 * 86400_000)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(10 * 86400_000 + 1000)
      expect(done).toBe(true)
      let aborted = false; const d = new AbortController()
      void pause(40 * 86400_000, d.signal).then(() => { aborted = true })
      d.abort(); await vi.advanceTimersByTimeAsync(0)
      expect(aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
