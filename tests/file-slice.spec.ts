import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_SLICE_BYTES, readWorkspaceSlice } from '../src/executor/file-slice.ts'

describe('ticket-scoped bounded source file reads', () => {
  let directory: string
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dsh-file-slice-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('returns only the requested lines, with an explicit continuation', async () => {
    await writeFile(join(directory, 'example.ts'), 'one\ntwo\nthree\nfour\n')
    const page = await readWorkspaceSlice(directory, 'example.ts', 2, 2)
    expect(page).toMatchObject({ path: 'example.ts', start_line: 2, lines: 2, text: 'two\nthree',
      next_line: 4, truncated_by: 'line_limit' })
    expect((await readWorkspaceSlice(directory, 'example.ts', page.next_line!, 2)).text).toBe('four')
  })

  it('preserves UTF-8 code points and handles missing final newlines', async () => {
    await writeFile(join(directory, 'utf8.txt'), '😀\ncafé')
    expect((await readWorkspaceSlice(directory, 'utf8.txt', 1, 10)).text).toBe('😀\ncafé')
    expect((await readWorkspaceSlice(directory, 'utf8.txt', 2, 10)).text).toBe('café')
  })

  it('never returns a whole oversized single line or a non-progressing continuation', async () => {
    await writeFile(join(directory, 'huge.txt'), 'a'.repeat(MAX_SLICE_BYTES * 3))
    const page = await readWorkspaceSlice(directory, 'huge.txt')
    expect(page.truncated_by).toBe('byte_limit')
    expect(page.next_line).toBeNull()
    expect(page.returned_bytes).toBe(MAX_SLICE_BYTES)
    expect(page.text).toHaveLength(MAX_SLICE_BYTES)
  })

  it('rejects directory traversal, absolute paths and symlinks to external files', async () => {
    const outside = join(tmpdir(), 'outside-' + directory.split('/').at(-1))
    await writeFile(outside, 'outside')
    try {
      await symlink(outside, join(directory, 'external'))
      await expect(readWorkspaceSlice(directory, '../outside')).rejects.toThrow('Invalid workspace')
      await expect(readWorkspaceSlice(directory, outside)).rejects.toThrow('Invalid workspace')
      await expect(readWorkspaceSlice(directory, 'external')).rejects.toThrow('outside the ticket workspace')
    } finally { await rm(outside, { force: true }) }
  })

  it('does not read from a missing workspace or with an aborted signal', async () => {
    await writeFile(join(directory, 'a'), 'ok')
    await expect(readWorkspaceSlice(undefined, 'a')).rejects.toThrow('no prepared workspace')
    const abort = new AbortController()
    abort.abort()
    await expect(readWorkspaceSlice(directory, 'a', 1, 10, abort.signal)).rejects.toThrow()
  })

  it('rejects invalid page coordinates', async () => {
    await writeFile(join(directory, 'a'), 'ok')
    await expect(readWorkspaceSlice(directory, 'a', 0)).rejects.toThrow('Invalid workspace')
    await expect(readWorkspaceSlice(directory, 'a', 1, 201)).rejects.toThrow('Invalid workspace')
  })
})
