/** Validated worker-ancestry resolution for managed subagents: no arbitrary depth bound, cycle-safe, fail-closed. */

/** How a Session relates to dsh-superagent's managed worker Sessions. */
export type WorkerAncestry =
  /** Descendant of a managed worker Session; `ticketId` names the originating authorized Ticket. */
  | { kind: 'worker'; ticketId: string }
  /** An independently created Session or a descendant of unmanaged Sessions, which is never restricted here. */
  | { kind: 'unmanaged' }
  /** Ancestry that cannot be trusted: a parent Session is gone, the metadata cycles, or the safety bound was exceeded. */
  | { kind: 'unresolved'; reason: 'missing-parent' | 'cycle' | 'depth' }

/**
 * Defensive bound on ancestry hops, far past any legitimate subagent nesting. The visited set already terminates
 * cycles, so this only bounds walks over corrupt metadata; exceeding it resolves `unresolved`, never unrestricted.
 */
export const ANCESTRY_HOPS_MAX = 64

/**
 * Resolves the managed worker Session `start` descends from by walking `parentSession` links. Terminal conditions:
 * no parent (an independently created Session or the top of an unmanaged chain), the master's Session (unmanaged), or
 * a worker Session, whose id names the Ticket its restrictions inherit from. A broken link, a cycle or the safety
 * bound resolves `unresolved`, whose callers fail closed for managed work.
 */
export function resolveWorkerAncestry(
  start: { id: string; parentSession?: string },
  parentOf: (sessionId: string) => { parentSession?: string } | undefined,
  ticketOf: (sessionId: string) => string | undefined,
  masterId: string,
): WorkerAncestry {
  let parent = start.parentSession
  if (parent === undefined) return { kind: 'unmanaged' }
  const visited = new Set([start.id])
  let hops = 0
  while (parent !== undefined) {
    const ticketId = ticketOf(parent)
    if (ticketId !== undefined) return { kind: 'worker', ticketId }
    if (parent === masterId) return { kind: 'unmanaged' }
    if (visited.has(parent)) return { kind: 'unresolved', reason: 'cycle' }
    visited.add(parent)
    if (++hops >= ANCESTRY_HOPS_MAX) return { kind: 'unresolved', reason: 'depth' }
    const header = parentOf(parent)
    if (header === undefined) return { kind: 'unresolved', reason: 'missing-parent' }
    parent = header.parentSession
  }
  return { kind: 'unmanaged' }
}
