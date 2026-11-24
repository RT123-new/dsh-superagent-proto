import { describe, expect, it } from 'vitest'
import { ResumeSnapshotInputSchema, ResumeSnapshotSchema, resumeSnapshotHint } from '../src/app/resume-snapshot.ts'
import type { ResumeSnapshot, Ticket } from '../src/core/index.ts'

const input = () => ({
  currentState: 'Pagination fix implemented but not reviewed.',
  nextAction: 'Run the GitHub paging regression tests.',
  openQuestion: 'Does the cursor survive a crash between pages?',
  completedWork: ['Added bounded paging loop.'],
  testsPerformed: ['Unit tests passed in recorded run.'],
  remainingWork: ['Run full integration tests.'],
  evidenceRefs: ['src/sources/github.ts'],
  gitHeadAtCapture: 'a'.repeat(40),
})
const persisted = (): ResumeSnapshot => ({ ...input(), schemaVersion: 1, ticketId: 'ticket-1',
  assignmentId: 'assignment-1', capturedAt: '2026-11-04T12:00:00.000Z', revision: 1 })
const ticket = (snapshot?: ResumeSnapshot): Ticket => ({
  id: 'ticket-1', assignments: [{ id: 'assignment-1', state: 'running', createdAt: '2026-11-04T11:00:00.000Z' }],
  inputs: [], ...snapshot ? { resumeSnapshot: snapshot } : {},
} as unknown as Ticket)

describe('resume snapshots', () => {
  it('validates a small bounded worker payload and the host-owned identity', () => {
    expect(ResumeSnapshotInputSchema.parse(input())).toMatchObject({ nextAction: input().nextAction })
    expect(ResumeSnapshotSchema.parse(persisted())).toMatchObject({ revision: 1, schemaVersion: 1 })
    expect(ResumeSnapshotInputSchema.safeParse({ ...input(), revision: 999 }).success).toBe(false)
    expect(ResumeSnapshotSchema.safeParse({ ...persisted(), revision: 0 }).success).toBe(false)
    expect(ResumeSnapshotInputSchema.safeParse({ ...input(), currentState: '' }).success).toBe(false)
  })
  it('refuses oversized notes and recognisable credentials', () => {
    expect(ResumeSnapshotInputSchema.safeParse({ ...input(), evidenceRefs: Array(12).fill('x'.repeat(300)),
      completedWork: Array(8).fill('x'.repeat(300)) }).success).toBe(false)
    expect(ResumeSnapshotInputSchema.safeParse({ ...input(), nextAction: 'Use token=abcdefghijklmnopqrstuvxyz' }).success).toBe(false)
    expect(ResumeSnapshotInputSchema.safeParse({ ...input(), gitHeadAtCapture: 'not-a-sha' }).success).toBe(false)
    for (const nextAction of ['github_pat_' + 'a'.repeat(30), 'Bearer\nabcdefghijklmnopqrst', '{"token":"abcdefghijklmnopqrst"}']) {
      expect(ResumeSnapshotInputSchema.safeParse({ ...input(), nextAction }).success).toBe(false)
    }
  })
  it('injects only a bounded untrusted hint and a read pointer for the correct ticket', () => {
    expect(resumeSnapshotHint(ticket(persisted()))).toMatchObject({
      next: input().nextAction, verify_before_acting: true, potentially_stale: false,
      read: 'ticket/ticket-1/resume-snapshot',
    })
    expect(resumeSnapshotHint(ticket({ ...persisted(), ticketId: 'another-ticket' }))).toBeUndefined()
    expect(resumeSnapshotHint(ticket())).toBeUndefined()
    expect(resumeSnapshotHint(ticket({ ...persisted(), assignmentId: 'unknown-assignment' }))).toBeUndefined()
  })
  it('marks a newer human input or changed assignment as potentially stale', () => {
    const later = ticket(persisted())
    later.inputs = [{ id: 'message-2', kind: 'text', at: '2026-11-04T12:01:00.000Z', text: 'New constraint' }]
    expect(resumeSnapshotHint(later)).toMatchObject({ potentially_stale: true })
    const sameInstant = ticket(persisted())
    sameInstant.inputs = [{ id: 'message-3', kind: 'text', at: '2026-11-04T13:00:00+01:00', text: 'Same instant' }]
    expect(resumeSnapshotHint(sameInstant)).toMatchObject({ potentially_stale: true })
    const undelivered = ticket(persisted())
    undelivered.undelivered = ['older-pending-input']
    expect(resumeSnapshotHint(undelivered)).toMatchObject({ potentially_stale: true })
    const newAssignment = ticket(persisted())
    newAssignment.assignments.push({ id: 'assignment-2', state: 'pending', createdAt: '2026-11-04T12:03:00.000Z' })
    expect(resumeSnapshotHint(newAssignment)).toMatchObject({ potentially_stale: true })
  })
  it('requires an input read before capture, with conservative handling of legacy and ambiguous times', () => {
    for (const [readAt, deliveredAt, stale] of [
      ['2026-11-04T11:59:59.000Z', undefined, false],
      ['2026-11-04T13:00:00+01:00', undefined, true],
      ['invalid', undefined, true],
      [null, undefined, true],
      [undefined, undefined, true],
      [undefined, '2026-11-04T11:59:59.000Z', false],
      [undefined, '2026-11-04T12:00:01.000Z', true],
    ] as const) {
      const value = ticket(persisted())
      value.inputs = [{ id: 'message', kind: 'trigger', triggerId: 'trigger',
        at: '2026-11-04T11:59:00.000Z', readAt, deliveredAt }]
      expect(resumeSnapshotHint(value)?.potentially_stale).toBe(stale)
    }
  })
})
