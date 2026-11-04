/** Offline read-volume probe. Counts bytes and API calls, never estimates model tokens or billing. */
import { pathToFileURL } from 'node:url'
import { Commands } from '../src/infra/commands.ts'
import { TextCache } from '../src/app/cache.ts'
import { readResource, type ResourceHost } from '../src/app/resources.ts'
import type { Deployment } from '../src/deployment.ts'

export const correction = 'CORRECTION: keep authorization checks; do not enable auto-merge.'
export function contextFixture() {
  let version = 1
  let calls = 0
  const commands = new Commands(() => ({ repository: 'fixture/repository', github: { cli: 'offline' } } as Deployment), {}, new AbortController().signal)
  commands.run = async (_program, args) => {
    calls++
    const path = args[1] ?? ''
    const page = Number(/page=(\d+)$/.exec(path)?.[1] ?? 1)
    const count = page === 1 ? 20 : 3
    return JSON.stringify(Array.from({ length: count }, (_, index) => ({ id: page * 100 + index, user: { login: 'fixture-user', type: 'User' },
      created_at: '2026-01-01T00:00:00Z', body: index === 0 && page === 1 ? `${correction} Revision ${version}.` : `${page}:${index} ${'Evidence. '.repeat(40)} 🚦` })))
  }
  // Only the GitHub resource route is exercised; it uses commands/pages/masterId, never Store or settings.
  const host = { commands, pages: new TextCache(4_000_000), masterId: 'offline-master' } as ResourceHost
  return { host, get calls() { return calls }, advance() { version++ } }
}

export async function fullRead(host: ResourceHost, resource: string, ticketId?: string, limit = 4000) {
  let offset: number | null = 0
  let body = ''
  let pages = 0
  do {
    const value = await readResource(host, resource, offset, limit, ticketId) as { text: string; next_offset: number | null }
    body += value.text; offset = value.next_offset; pages++
  } while (offset !== null)
  return { body, pages }
}

export async function runContextWorkload(conversations: number, sessions: number, seed: number, tasks = 200) {
  const fixture = contextFixture()
  const seen = new Set<string>()
  let returnedBytes = 0, repeatedBytes = 0, toolReads = 0, correct = 0
  for (let task = 0; task < tasks; task++) {
    const conversation = (task * 17 + seed) % conversations + 1
    const session = `worker-${(task + seed) % sessions}`
    const initial = `github/issues/${conversation}/comments/1`
    // Replay actual current resource semantics: fresh offset0, cached continuation, repeat, and another Session.
    const first = await fullRead(fixture.host, initial, session)
    const repeat = await fullRead(fixture.host, initial, session)
    const other = await fullRead(fixture.host, initial, `${session}-other`)
    const next = JSON.parse(first.body) as { messages: { text: string }[]; next_resource?: string }
    const older = next.next_resource ? await fullRead(fixture.host, next.next_resource, session) : undefined
    for (const read of [first, repeat, other, older].filter(value => value !== undefined)) {
      toolReads += read.pages
      const bytes = Buffer.byteLength(read.body)
      returnedBytes += bytes
      if (seen.has(read.body)) repeatedBytes += bytes
      seen.add(read.body)
    }
    // A retrieval oracle, NOT successful model execution: all pages and the correction remain available byte-for-byte.
    if (first.body === repeat.body && repeat.body === other.body && next.messages[0]?.text.includes(correction) && older
      && (JSON.parse(older.body) as { messages: unknown[] }).messages.length === 3) correct++
  }
  return { conversations, sessions, seed, tasks, source_api_calls: fixture.calls, tool_reads: toolReads,
    returned_utf8_bytes: returnedBytes, repeated_utf8_bytes: repeatedBytes, retrieval_oracle_success: correct,
    raw_input_tokens: null, cached_input_tokens: null, output_tokens: null, task_success: null,
    caveat: 'Offline retrieval oracle only. No model ran; token usage, model task success and billing are unknown.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = []
  // One factor at a time, not a Cartesian product. Five seeds and 200 tasks per profile.
  for (const [conversations, sessions] of [[5, 3], [20, 3], [100, 3], [20, 6], [20, 12]])
    for (const seed of [1, 2, 3, 4, 5]) results.push(await runContextWorkload(conversations!, sessions!, seed))
  console.log(JSON.stringify({ baseline: '3b58209', workload_version: 1, results }, null, 2))
}
