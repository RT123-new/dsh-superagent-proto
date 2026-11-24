/** Bounded, workspace-contained file reads. Not an OS sandbox against concurrent filesystem mutation. */
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export const MAX_SLICE_LINES = 200
export const MAX_SLICE_BYTES = 12 * 1024
/** Bound disk I/O as well as returned text; use a targeted search for very deep/large files. */
export const MAX_SLICE_SCAN_BYTES = 16 * 1024 * 1024

export interface FileSlice {
  path: string
  start_line: number
  lines: number
  text: string
  returned_bytes: number
  next_line: number | null
  truncated_by: 'line_limit' | 'byte_limit' | null
}

/**
 * Return a small line-addressable piece of a regular file. The output byte budget
 * includes line separators. When a subsequent line does not fit, do not return
 * its incomplete prefix: retry that line as the first line of the next page.
 * An individually oversized first line returns a bounded prefix without a cursor.
 */
export async function readWorkspaceSlice(directory: string | undefined, path: string,
  startLine = 1, maxLines = 160, signal?: AbortSignal): Promise<FileSlice> {
  if (!directory) throw new Error('Ticket has no prepared workspace')
  if (!path || path.includes('\0') || isAbsolute(path) || win32.isAbsolute(path)
    || path.split(/[\\/]/).some(part => part === '..' || part === '.')
    || !Number.isSafeInteger(startLine) || startLine < 1
    || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > MAX_SLICE_LINES) {
    throw new Error('Invalid workspace file slice request')
  }
  signal?.throwIfAborted()
  const root = await realpath(directory)
  const target = await realpath(join(root, path))
  const inside = relative(root, target)
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) {
    throw new Error('File is outside the ticket workspace')
  }
  // Opening a FIFO for reading can block indefinitely before fstat or cancellation.
  // Precheck, then use nonblocking/no-follow open and verify the opened descriptor.
  if (!(await stat(target)).isFile()) throw new Error('Not a regular file')
  signal?.throwIfAborted()
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file')
    const buffer = Buffer.allocUnsafe(4096), decoder = new StringDecoder('utf8')
    const lines: string[] = []
    let line = 1, part = '', partBytes = 0, bytes = 0, scanned = 0
    let stopped: FileSlice['truncated_by'] = null
    let next: number | null = null
    const separator = () => lines.length ? 1 : 0
    const byteLimit = () => {
      stopped = 'byte_limit'
      // Completed lines are safe to return; retry the unreturned line on its own.
      next = lines.length ? line : null
    }
    const finishLine = (): void => {
      const value = part.endsWith('\r') ? part.slice(0, -1) : part
      const size = Buffer.byteLength(value, 'utf8')
      if (bytes + separator() + size > MAX_SLICE_BYTES) { byteLimit(); return }
      bytes += separator() + size
      lines.push(value)
      part = ''
      partBytes = 0
      line++
    }
    const visit = (piece: string): void => {
      // Avoid iterating over every character of a skipped prefix.
      let offset = 0
      while (line < startLine) {
        const newline = piece.indexOf('\n', offset)
        if (newline < 0) return
        offset = newline + 1
        line++
      }
      for (const char of piece.slice(offset)) {
        if (stopped) break
        // Observe one more character before advertising a next page. Exactly-full
        // files ending at the line cap must not expose a phantom continuation.
        if (lines.length >= maxLines) { stopped = 'line_limit'; next = line; break }
        if (char === '\n') { finishLine(); continue }
        const size = Buffer.byteLength(char, 'utf8')
        if (bytes + separator() + partBytes + size > MAX_SLICE_BYTES) { byteLimit(); break }
        partBytes += size
        part += char
      }
    }
    for (;;) {
      signal?.throwIfAborted()
      // One extra byte distinguishes exact EOF at the scan ceiling from a deeper file.
      const length = Math.min(buffer.length, MAX_SLICE_SCAN_BYTES - scanned + 1)
      const { bytesRead } = await handle.read(buffer, 0, length, null)
      signal?.throwIfAborted()
      if (!bytesRead) { visit(decoder.end()); break }
      scanned += bytesRead
      if (scanned > MAX_SLICE_SCAN_BYTES) throw new Error('File slice scan limit exceeded; use a narrower search')
      visit(decoder.write(buffer.subarray(0, bytesRead)))
      if (stopped) break
    }
    if (!stopped && part.length) finishLine()
    if (stopped === 'byte_limit' && !lines.length && part.length) lines.push(part)
    signal?.throwIfAborted()
    const text = lines.join('\n')
    return { path, start_line: startLine, lines: lines.length, text,
      returned_bytes: Buffer.byteLength(text, 'utf8'), next_line: next, truncated_by: stopped }
  } finally {
    await handle.close()
  }
}
