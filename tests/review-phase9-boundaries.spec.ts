/** Final review phase 9 (independent adversary): GitHub path and repository boundaries, and the workspace-root symlink characterization. */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Commands } from '../src/infra/commands.ts'
import { githubAddress } from '../src/sources/github-trigger.ts'
import { readGithub, readRepositoryPath } from '../src/sources/github-read.ts'
import { ExecutorFixture, immediate } from './fixtures/executor.ts'
import { testDeployment } from './fixtures/deployment.ts'

const deployment = testDeployment()
const commands = () => { const c = new Commands(() => deployment, {}, new AbortController().signal); const run = vi.spyOn(c, 'run').mockResolvedValue('{}'); return { c, run } }
const argvOf = (run: ReturnType<typeof vi.spyOn>) => (run.mock.calls[0]?.[1] as string[] | undefined)?.[1]

it('a reply address naming another repository is not a reply address (cross-repository aliasing)', () => {
  const repo = deployment.repository
  expect(githubAddress(`https://github.com/${repo}/pulls/5#discussion_r9`, repo)).toMatchObject({ number: 5, discussion: 9 })
  for (const other of ['evil/widgets', `${repo}-evil`, `x${repo}`, `${repo}/extra`]) {
    expect(githubAddress(`https://github.com/${other}/pulls/5#discussion_r9`, repo), other).toBeUndefined()
  }
  expect(githubAddress(`https://evil.example/${repo}/pulls/5`, repo)).toBeUndefined()
})
it('the agent-facing read resource accepts only issue/pull numbers and a hex commit; anything else is refused before any gh call', async () => {
  for (const resource of ['github/pulls/1/../../user', 'github/pulls/1%2f..', 'github/issues/1/comments/../x', 'github/commits/ZZZ/checks', 'github/commits/abc1234/../x/checks', 'github/pulls/0', 'github/orgs/x', 'github/pulls/1/comments/0']) {
    const { c, run } = commands()
    await expect(readGithub(c, resource), resource).rejects.toThrow()
    expect(run, resource).not.toHaveBeenCalled()
  }
})
it('Commands.api refuses explicit traversal and absolute forms; percent-encoded forms are handed to gh verbatim (characterization: decoding is on the server, unverified offline)', async () => {
  for (const hostile of ['../user', '/user', 'https://evil/x', 'a/../b', './x']) {
    const { c, run } = commands(); await expect(c.api(z.object({}), hostile), hostile).rejects.toThrow(); expect(run).not.toHaveBeenCalled()
  }
  const { c, run } = commands(); await c.api(z.object({}), '%2e%2e/user')
  expect(argvOf(run)).toBe(`repos/${deployment.repository}/%2e%2e/user`)
})
it('the repository-file tool double-encodes percent forms and refuses traversal and hidden paths', async () => {
  for (const hostile of ['../x', '.git/config', 'a/.env', 'node_modules/x']) {
    const { c, run } = commands(); await expect(readRepositoryPath(c, hostile, 'file'), hostile).rejects.toThrow(); expect(run).not.toHaveBeenCalled()
  }
  const { c, run } = commands(); await readRepositoryPath(c, '%2e%2e/user', 'file')
  expect(argvOf(run)).toBe(`repos/${deployment.repository}/contents/%252e%252e/user`)
})

let f: ExecutorFixture
afterEach(() => f?.dispose())
it('a symlink planted at <executionRoot>/<ticket name> no longer escapes: the launch fails closed (containment repaired by the lead)', async () => {
  f = new ExecutorFixture({ prepare: '' })
  const { ticket, assignment } = f.mkTicket('symlinked')
  const outside = mkdtempSync(join(tmpdir(), 'outside-')); writeFileSync(join(outside, 'secret.txt'), 'x')
  mkdirSync(join(ticket.execution!.directory, '..'), { recursive: true })
  symlinkSync(outside, ticket.execution!.directory)
  f.intercept = spec => spec.argv[0] === 'sh' ? immediate(0) : undefined
  await f.launch(ticket, assignment)
  expect(f.engine.report).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ state: 'failed', summary: expect.stringContaining('outside its execution root') }))
  expect((f.sessions.prompt as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0)
})
