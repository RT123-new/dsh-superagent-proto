/** Issue 8: unit coverage for validated ancestry resolution - terminal conditions, cycles, and the safety bound. */
import { expect, it } from 'vitest'
import { ANCESTRY_HOPS_MAX, resolveWorkerAncestry } from '../src/app/ancestry.ts'
import { ticketOfSession } from '../src/executor/dsh.ts'

const MASTER = 'master'
const lookup = (sessions: Record<string, { parentSession?: string }>) => (id: string) => sessions[id]

/** A chain worker-t1 <- c1 <- ... <- cN <- target. */
function chain(intermediates: number) {
  const sessions: Record<string, { parentSession?: string }> = { 'worker-t1': {} }
  let parent = 'worker-t1'
  for (let i = 1; i <= intermediates; i++) { sessions[`c${i}`] = { parentSession: parent }; parent = `c${i}` }
  return { sessions, target: { id: 'target', parentSession: parent } }
}

it.each([1, 8, 9, 20, ANCESTRY_HOPS_MAX - 1])('resolves the originating ticket through %i nested subagent(s)', intermediates => {
  const { sessions, target } = chain(intermediates)
  expect(resolveWorkerAncestry(target, lookup(sessions), ticketOfSession, MASTER)).toEqual({ kind: 'worker', ticketId: 't1' })
})

it('bounds the walk at the safety bound and reports it unresolved rather than unbounded or unrestricted', () => {
  const { sessions, target } = chain(ANCESTRY_HOPS_MAX + 10)
  expect(resolveWorkerAncestry(target, lookup(sessions), ticketOfSession, MASTER)).toEqual({ kind: 'unresolved', reason: 'depth' })
})

it('treats a Session with no parent as independently created', () => {
  expect(resolveWorkerAncestry({ id: 'user-1' }, lookup({}), ticketOfSession, MASTER)).toEqual({ kind: 'unmanaged' })
})

it('treats a subagent chain ending at an unmanaged Session as unmanaged', () => {
  const sessions = { 'user-1': {}, c1: { parentSession: 'user-1' } }
  expect(resolveWorkerAncestry({ id: 'target', parentSession: 'c1' }, lookup(sessions), ticketOfSession, MASTER))
    .toEqual({ kind: 'unmanaged' })
})

it('treats a subagent of the main Session as unmanaged', () => {
  expect(resolveWorkerAncestry({ id: 'target', parentSession: MASTER }, lookup({}), ticketOfSession, MASTER)).toEqual({ kind: 'unmanaged' })
})

it('detects a cycle instead of walking forever', () => {
  const sessions = { c1: { parentSession: 'c2' }, c2: { parentSession: 'c1' } }
  expect(resolveWorkerAncestry({ id: 'target', parentSession: 'c1' }, lookup(sessions), ticketOfSession, MASTER))
    .toEqual({ kind: 'unresolved', reason: 'cycle' })
})

it('reports a parent that is not loaded as unresolved', () => {
  expect(resolveWorkerAncestry({ id: 'target', parentSession: 'ghost' }, lookup({}), ticketOfSession, MASTER))
    .toEqual({ kind: 'unresolved', reason: 'missing-parent' })
})
