/** Bounded, workspace-contained file reads for worker models. Not an OS sandbox against concurrent filesystem mutation. */
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep, win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export const MAX_SLICE_LINES = 200
export const MAX_SLICE_BYTES = 12 * 1024

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
 * Return a small, line-addressable piece of a file. A 4-KiB buffer and UTF-8 decoder keep
 * memory bounded even for long single-line inputs; no entire file enters model context.
 * The canonical workspace root is checked before opening. Like the existing workspace
 * containment, this is an application-level check, not a defense against an attacker
 * swapping ancestor directories between the realpath and open operations.
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
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file')
    const buffer = Buffer.allocUnsafe(4096), decoder = new StringDecoder('utf8')
    const lines: string[] = []
    let line = 1, part = '', bytes = 0, stopped: FileSlice['truncated_by'] = null
    let lastLine = startLine - 1
    const visit = (piece: string): void => {
      for (const char of piece) {
        if (stopped) break
        if (char === '\n') {
          if (line >= startLine) {
            lines.push(part.endsWith('\r') ? part.slice(0, -1) : part)
            lastLine = line
            if (lines.length >= maxLines) { stopped = 'line_limit'; break }
          }
          part = ''
          line++
        } else if (line >= startLine) {
          const size = Buffer.byteLength(char, 'utf8')
          if (bytes + size > MAX_SLICE_BYTES) { stopped = 'byte_limit'; break }
          bytes += size
          part += char
        }
      }
    }
    for (;;) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) { visit(decoder.end()); break }
      visit(decoder.write(buffer.subarray(0, bytesRead)))
      if (stopped) break
    }
    if (!stopped && line >= startLine && part.length) { lines.push(part); lastLine = line }
    // The continuation cursor is line-addressable. A byte-capped single line needs a
    // narrower query or a different tool; do not offer a cursor that cannot progress.
    return { path, start_line: startLine, lines: lines.length, text: lines.join('\n'),
      returned_bytes: Buffer.byteLength(lines.join('\n'), 'utf8'),
      next_line: stopped === 'line_limit' ? lastLine + 1 : null,
      truncated_by: stopped }
  } finally {
    await handle.close()
  }
}
