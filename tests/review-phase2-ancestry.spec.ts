/** Final review: ancestry adversarial cases beyond issue-8 (self-parent, worker beyond an unmanaged hop, exact bound, restrictions never silently lifted). */
import { expect, it } from 'vitest'
import { ANCESTRY_HOPS_MAX, resolveWorkerAncestry } from '../src/app/ancestry.ts'

const tickets = (map: Record<string, string>) => (id: string) => map[id]
it('a Session that is its own parent is a cycle, not unmanaged', () => {
  expect(resolveWorkerAncestry({ id: 's', parentSession: 's' }, () => ({ parentSession: 's' }), () => undefined, 'master')).toEqual({ kind: 'unresolved', reason: 'cycle' })
})
it('a worker found behind several unmanaged hops still names its ticket (restrictions inherited)', () => {
  const headers: Record<string, { parentSession?: string }> = { a: { parentSession: 'b' }, b: { parentSession: 'w' } }
  expect(resolveWorkerAncestry({ id: 's', parentSession: 'a' }, id => headers[id], tickets({ w: 'T1' }), 'master')).toEqual({ kind: 'worker', ticketId: 'T1' })
})
it('a missing link before a worker is unresolved, never unmanaged', () => {
  expect(resolveWorkerAncestry({ id: 's', parentSession: 'gone' }, () => undefined, () => undefined, 'master')).toEqual({ kind: 'unresolved', reason: 'missing-parent' })
})
it('a chain exactly one hop short of the bound resolves; one at the bound is unresolved depth', () => {
  const chain = (length: number) => (id: string) => { const n = Number(id.slice(1)); return n < length ? { parentSession: `p${n + 1}` } : {} }
  const run = (length: number) => resolveWorkerAncestry({ id: 's', parentSession: 'p0' }, chain(length), () => undefined, 'master')
  expect(run(ANCESTRY_HOPS_MAX - 3).kind).toBe('unmanaged')
  expect(run(ANCESTRY_HOPS_MAX + 5)).toEqual({ kind: 'unresolved', reason: 'depth' })
})
