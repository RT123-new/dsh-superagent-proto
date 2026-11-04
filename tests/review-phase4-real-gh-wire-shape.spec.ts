import { describe, expect, it, vi } from 'vitest'
import { Commands } from '../src/infra/commands.ts'
import { z } from 'zod'

/**
 * Real-call validation finding (2026-11-04): the REAL gh 2.103.2 output for `api --paginate --slurp --include`
 * wraps the header blocks INSIDE the slurp array text: `[HTTP/2.0 200 OK\n<headers>\n\n[page1]\n,HTTP/2.0 200 OK\n<headers>\n\n[page2]\n]`.
 * The earlier fixtures encoded headers BEFORE the outer bracket and blocks after `\n` - a shape real gh never emits.
 * Structure below mirrors the preserved anonymized capture (reports/round-2026-11-04/evidence/).
 */
const REAL_WIRE = '[HTTP/2.0 200 OK\nContent-Type: application/json; charset=utf-8\n\n[{"id":1}]\n,HTTP/2.0 200 OK\nContent-Type: application/json; charset=utf-8\n\n[{"id":2}]\n]'
const REAL_WIRE_CRLF = REAL_WIRE.replace(/\n/g, '\r\n')
// Older documented shape (kept working): headers first, blocks after a line boundary.
const LEGACY_WIRE = 'HTTP/2.0 200 OK\r\n\r\n[[{"id":1}],\nHTTP/2.0 200 OK\r\nRetry-After: 7\r\n\r\n[{"id":2}]]\n'

const deployment = { repository: 'owner/repo', github: { cli: 'gh', login: 'bot', noreply: 'bot' } } as never
const commands = () => new Commands(() => deployment, {}, new AbortController().signal)

describe('real gh wire shape (paginate --slurp --include)', () => {
  it('parses the real slurp-wrapped interleave and yields every page item', async () => {
    const value = commands()
    vi.spyOn(value, 'run').mockResolvedValue(REAL_WIRE)
    await expect(value.pages(z.looseObject({ id: z.number() }), 'issues')).resolves.toEqual([{ id: 1 }, { id: 2 }])
  })
  it('survives page content that literally contains the header-block text (real 91bac4d commit message case)', async () => {
    // The real failure that proved regex boundary scanning unsafe: a commit message on the live branch contains the
    // literal text `[HTTP/2.0 200 OK\\n<headers>...` (JSON-escaped). A boundary REGEX matches inside that JSON string and
    // corrupts the body; only a structural scan (gh bodies are single-line JSON, so raw newlines are always structural) is safe.
    const poisoned = '[HTTP/2.0 200 OK\nContent-Type: application/json\n\n[{"id":1,"message":"fix: wrap [HTTP/2.0 200 OK\\n<headers>\\n\\n[page1]\\n,HTTP/2.0 200 OK\\n<headers>\\n\\n[page2]\\n] literally"}]\n,HTTP/2.0 200 OK\nContent-Type: application/json\n\n[{"id":2}]\n]'
    const value = commands()
    vi.spyOn(value, 'run').mockResolvedValue(poisoned)
    await expect(value.pages(z.looseObject({ id: z.number(), message: z.string().optional() }), 'issues')).resolves.toHaveLength(2)
  })
  it('parses the same real shape with CRLF endings', async () => {
    const value = commands()
    vi.spyOn(value, 'run').mockResolvedValue(REAL_WIRE_CRLF)
    await expect(value.pages(z.looseObject({ id: z.number() }), 'issues')).resolves.toEqual([{ id: 1 }, { id: 2 }])
  })
  it('keeps the legacy headers-first shape working, with the last block typed', async () => {
    const value = commands()
    const run = vi.spyOn(value, 'run').mockResolvedValue(LEGACY_WIRE)
    await expect(value.pages(z.looseObject({ id: z.number() }), 'issues')).resolves.toEqual([{ id: 1 }, { id: 2 }])
    expect(run).toHaveBeenCalled()
  })
  it('a single-page --include success keeps its body intact', async () => {
    const value = commands()
    vi.spyOn(value, 'run').mockResolvedValue('HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"ok":true}')
    await expect(value.api(z.looseObject({ ok: z.boolean() }), 'commits/abc')).resolves.toEqual({ ok: true })
  })
})
