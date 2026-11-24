import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_SLICE_BYTES, MAX_SLICE_SCAN_BYTES, readWorkspaceSlice } from '../src/executor/file-slice.ts'

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

  it('counts separators and resumes an omitted line without losing source text', async () => {
    await writeFile(join(directory, 'boundary.txt'), 'a'.repeat(MAX_SLICE_BYTES - 1) + '\nβeta\nlast')
    const first = await readWorkspaceSlice(directory, 'boundary.txt')
    expect(first).toMatchObject({ lines: 1, returned_bytes: MAX_SLICE_BYTES - 1, next_line: 2, truncated_by: 'byte_limit' })
    expect((await readWorkspaceSlice(directory, 'boundary.txt', first.next_line!)).text).toBe('βeta\nlast')
    await writeFile(join(directory, 'blank.txt'), 'a'.repeat(MAX_SLICE_BYTES) + '\n\n')
    expect(await readWorkspaceSlice(directory, 'blank.txt')).toMatchObject({ lines: 1, returned_bytes: MAX_SLICE_BYTES, next_line: 2, truncated_by: 'byte_limit' })
    expect(await readWorkspaceSlice(directory, 'blank.txt', 2)).toMatchObject({ text: '', lines: 1, next_line: null })
  })

  it('does not advertise a nonexistent next page when the line cap equals EOF', async () => {
    await writeFile(join(directory, 'exact.txt'), 'one\r\ntwo\r\n')
    expect(await readWorkspaceSlice(directory, 'exact.txt', 1, 2)).toMatchObject({ text: 'one\ntwo', returned_bytes: 7, lines: 2, next_line: null, truncated_by: null })
    await writeFile(join(directory, 'exact.txt'), 'one\ntwo')
    expect(await readWorkspaceSlice(directory, 'exact.txt', 1, 2)).toMatchObject({ next_line: null, truncated_by: null })
  })

  it.each(['\n', '\r\n'])('keeps the continuation when text exactly fills the budget before %j', async eol => {
    const text = 'a'.repeat(MAX_SLICE_BYTES)
    await writeFile(join(directory, 'exact-budget.txt'), text + eol + 'last' + eol)
    const page = await readWorkspaceSlice(directory, 'exact-budget.txt')
    expect(page).toMatchObject({ text, returned_bytes: MAX_SLICE_BYTES, lines: 1, next_line: 2, truncated_by: 'byte_limit' })
    expect(await readWorkspaceSlice(directory, 'exact-budget.txt', page.next_line!)).toMatchObject({ text: 'last', lines: 1, next_line: null })
    await writeFile(join(directory, 'exact-budget.txt'), text + eol)
    expect(await readWorkspaceSlice(directory, 'exact-budget.txt')).toMatchObject({ text, next_line: null, truncated_by: null })
  })

  it('defers only a trailing CR and preserves embedded carriage returns at the budget boundary', async () => {
    // CRLF itself spans a 4096-byte read boundary; it must not consume output budget.
    const first = 'a'.repeat(4095), second = 'b'.repeat(MAX_SLICE_BYTES - first.length - 1)
    await writeFile(join(directory, 'split-crlf.txt'), first + '\r\n' + second + '\r\nlast')
    expect(await readWorkspaceSlice(directory, 'split-crlf.txt')).toMatchObject({
      text: first + '\n' + second, returned_bytes: MAX_SLICE_BYTES, lines: 2, next_line: 3, truncated_by: 'byte_limit',
    })
    await writeFile(join(directory, 'embedded-cr.txt'), 'a'.repeat(MAX_SLICE_BYTES - 1) + '\rb\r\nlast')
    expect(await readWorkspaceSlice(directory, 'embedded-cr.txt')).toMatchObject({
      text: 'a'.repeat(MAX_SLICE_BYTES - 1) + '\r', returned_bytes: MAX_SLICE_BYTES, next_line: null, truncated_by: 'byte_limit',
    })
  })

  it('bounds prefix scanning even when the requested line is absent', async () => {
    const path = join(directory, 'sparse.txt')
    await writeFile(path, '')
    await truncate(path, MAX_SLICE_SCAN_BYTES + 1)
    await expect(readWorkspaceSlice(directory, 'sparse.txt', 2)).rejects.toThrow('scan limit exceeded')
  })

  it.skipIf(process.platform === 'win32')('rejects a FIFO before opening it for a blocking read', async () => {
    execFileSync('mkfifo', [join(directory, 'pipe')])
    await expect(readWorkspaceSlice(directory, 'pipe')).rejects.toThrow('Not a regular file')
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
