/** Subprocess wrapper for running gh, lark-cli, and git commands under the deployment's configured accounts. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Deployment } from '../deployment.ts'
import { Probe } from './metrics-probe.ts'
import { TransportFailure } from './transport-failure.ts'

const exec = promisify(execFile)
const TIMEOUT_MS = 90_000
/** Page-count ceiling for the page-wise fallback; exceeding it fails visibly instead of looping. */
const MAX_PAGES = 1000
/**
 * Error thrown by Commands when a CLI invocation fails, capturing stderr diagnostics, API error codes, and exit status without echoing command arguments.
 * Source channels and pollers inspect its code to distinguish deleted conversations from retryable failures.
 */
export class CliError extends Error {
  /** True when the subprocess exceeded the output cap: the same request would exceed it again, so a retry cannot succeed. */
  oversized = false
  /** True when the subprocess succeeded but printed output that is not the expected JSON (truncated, proxy page): retryable. */
  unreadable = false
  /** Typed metadata parsed from real provider response headers at this boundary; absent whenever headers were unavailable. */
  transportFailure?: TransportFailure
  constructor(message: string, readonly code?: number, readonly exitCode?: number) { super(message) }
}
/** Splits a leading `gh api --include` response-header block from the body; values stay raw for the typed transport parser. */
function splitResponseHeaders(output: string): { status?: number; retryAfter?: string; body: string } {
  if (!output.startsWith('HTTP/')) return { body: output }
  const normalized = output.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n\n')
  if (end < 0) return { body: output }
  const head = normalized.slice(0, end)
  const status = Number(/^HTTP\/\S+ (\d{3})\b/.exec(head)?.[1]) || undefined
  const retryAfter = /^Retry-After:[ \t]*(.*?)[ \t]*$/im.exec(head)?.[1]
  return { status, retryAfter, body: normalized.slice(end + 2) }
}
/**
 * Reads the wire-stable retry metadata of a lark-cli typed stderr envelope (lark-cli 1.0.84+, errs/ERROR_CONTRACT.md:
 * `error.retry_after_seconds` from `x-ogw-ratelimit-reset`, then `Retry-After`, for retryable `api/rate_limit` and
 * HTTP-backed `network` errors). Branches only on `type`/`subtype`/`retryable`/`retry_after_seconds`; `message` is prose.
 */
function larkRetryMetadata(stderr: string): { status?: number; retryAfter?: number } | undefined {
  const start = stderr.indexOf('{')
  if (start < 0) return undefined
  let envelope: { error?: { type?: unknown; subtype?: unknown; retryable?: unknown; retry_after_seconds?: unknown } } | undefined
  try { envelope = JSON.parse(stderr.slice(start)) as typeof envelope }
  catch { return undefined }
  const typed = envelope?.error
  if (!typed || typed.retryable !== true) return undefined
  const rateLimited = typed.type === 'api' && typed.subtype === 'rate_limit'
  if (!rateLimited && typed.type !== 'network') return undefined
  const seconds = typed.retry_after_seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined
  return { status: rateLimited ? 429 : undefined, retryAfter: seconds }
}
/** Extracts a sanitized error from a failed subprocess without echoing argv, which may contain message text. */
export function commandError(error: unknown, program = 'command'): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const exitCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? error.code : undefined
  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    const stderr = error.stderr.trim()
    let parsed: { error?: { code?: number; message?: string } } | undefined
    try { parsed = JSON.parse(stderr.slice(stderr.indexOf('{'))) as typeof parsed }
    catch { /* Non-JSON CLI diagnostics are retained below. */ }
    const code = parsed?.error?.code
    if (parsed?.error?.message) return new CliError(`${parsed.error.message}${code ? ` (${code})` : ''}`, code, exitCode)
    // `gh` exits non-zero on HTTP errors (such as `gh: Not Found (HTTP 404)`) and on `gh: HTTP 304`, which ETag polling relies on.
    if (stderr) return new CliError(stderr.slice(0, 2000), Number(/\bHTTP (\d{3})\b/.exec(stderr)?.[1]) || undefined, exitCode)
  }
  const failure = new CliError(`${basename(program)} ${ended(error)}`, undefined, exitCode)
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') failure.oversized = true
  return failure
}
function ended(error: unknown): string {
  const { killed, signal, code } = (error ?? {}) as { killed?: boolean; signal?: string | null; code?: unknown }
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'printed more output than it may'
  // `execFile` timeout terminates the process with SIGTERM and sets `killed: true`.
  if (killed && signal === 'SIGTERM') return `timed out after ${TIMEOUT_MS / 1000} s`
  if (signal) return `was stopped by ${signal}`
  if (typeof code === 'number') return `exited with code ${code}`
  return typeof code === 'string' ? `could not run: ${code}` : 'failed'
}
/** `rejected` holds bounded, redacted diagnostics (identifier and failing field names only, never values) so a skipped item can be found and re-read. */
export interface Tally { skipped: number; rejected?: RejectedItem[] }
export interface RejectedItem { id?: string | number; fields: string[] }
const MAX_REJECTED = 20
/** Field names the Source schemas define; any other (remote-supplied) key is reported as `?`, so diagnostics never carry remote text. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set(['id', 'number', 'title', 'body', 'user', 'login', 'type', 'state', 'html_url', 'created_at', 'updated_at', 'submitted_at',
  'commit_id', 'path', 'line', 'original_line', 'diff_hunk', 'in_reply_to_id', 'name', 'status', 'conclusion', 'context', 'repository', 'subject', 'reason',
  'unread', 'url', 'check_runs', 'head', 'base', 'ref', 'sha', 'labels', 'draft', 'merged', 'pull_request', 'message_id', 'chat_id', 'create_time', 'msg_type',
  'sender', 'items', 'content', 'thread_id', 'parent_id', 'root_id'])
/** Parses array elements against a schema, skipping invalid items, incrementing `tally.skipped` and recording a redacted diagnostic. */
export function validItems<T>(item: z.ZodType<T>, list: readonly unknown[], tally?: Tally): T[] {
  const items = list.flatMap(value => {
    const parsed = item.safeParse(value)
    if (parsed.success) return [parsed.data]
    if (tally) {
      const rejected = tally.rejected ??= []
      if (rejected.length < MAX_REJECTED) {
        const id = value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : undefined
        // Remote text is untrusted: keep only a numeric id, or a short hash of anything else, and only plain identifier-shaped field names.
        const safeId = typeof id === 'number' && Number.isSafeInteger(id) ? id : typeof id === 'string' ? `sha256:${createHash('sha256').update(id).digest('hex').slice(0, 12)}` : undefined
        const field = (segment: PropertyKey) => typeof segment === 'string' && KNOWN_FIELDS.has(segment) ? segment : typeof segment === 'number' ? '#' : '?'
        rejected.push({ ...safeId !== undefined ? { id: safeId } : {},
          fields: [...new Set(parsed.error.issues.map(issue => issue.path.map(field).join('.') || '(item)'))].slice(0, 5) })
      }
    }
    return []
  })
  if (tally) tally.skipped += list.length - items.length
  return items
}
/** Rewrites Feishu error 232011 (bot not in chat) with remediation instructions. */
function membership(error: unknown): unknown {
  if (!(error instanceof CliError) || error.code !== 232011) return error
  const hint = 'The Feishu bot is not a member of the chat. Add the bot in the chat settings, then retry.'
  const rewritten = new CliError(hint, error.code, error.exitCode)
  rewritten.transportFailure = error.transportFailure
  return rewritten
}
/**
 * Executes gh, lark-cli, and git subprocesses with deployment account credentials, timeouts, and abort signals.
 * Restricts GitHub API calls to the configured repository and translates CLI failures into CliError instances for Sources, MasterAssessor, Outbox, and Settings.
 */
export class Commands {
  /**
   * @param resolved - returns the resolved deployment setup, or throws while setup is still pending.
   * @param environment - variables overriding `process.env` for every command (such as isolated git settings).
   */
  constructor(private readonly resolved: () => Deployment, private readonly environment: Record<string, string | undefined>, private readonly signal: AbortSignal, private readonly probe: Probe = new Probe(undefined)) {}
  get deployment(): Deployment { return this.resolved() }
  get repository(): string { return this.deployment.repository }
  withSignal(signal?: AbortSignal): Commands { return signal ? new Commands(this.resolved, this.environment, AbortSignal.any([this.signal, signal]), this.probe) : this }
  async run(program: string, args: string[], cwd?: string, transport?: { responseHeaders?: boolean; errorEnvelope?: boolean }): Promise<string> {
    // Whole subprocess latency: process start, network and the CLI's own work. Not pure API latency; the label never names the program or arguments.
    const stop = this.probe.timer('command_run', 'internal')
    try {
      const { stdout } = await exec(program, args, { cwd, signal: this.signal, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...this.environment, GH_PROMPT_DISABLED: '1', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } })
      stop()
      return stdout
    } catch (error) {
      stop('failed')
      const failure = commandError(error, program)
      // With `--include`, real gh prints the response headers on stdout even for HTTP-error exits (cli/cli processResponse).
      // Only this typed boundary may turn them into retry scheduling metadata; message text stays non-authoritative.
      if (transport?.responseHeaders && failure instanceof CliError) {
        const stdout = error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : ''
        const { status, retryAfter } = splitResponseHeaders(stdout)
        if (status !== undefined || retryAfter !== undefined) failure.transportFailure = new TransportFailure(failure.message, { status: status ?? failure.code, retryAfter })
      }
      // lark-cli >= 1.0.84 renders a typed error envelope on stderr; only this boundary turns its retry fields into scheduling metadata.
      if (transport?.errorEnvelope && failure instanceof CliError) {
        const stderr = error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
        const metadata = larkRetryMetadata(stderr)
        if (metadata) failure.transportFailure = new TransportFailure(failure.message, metadata)
      }
      throw failure
    }
  }
  /** Runs the agent's GitHub CLI and parses its JSON output; callers should prefer `api`, which is restricted to the configured repository and validates output. */
  async gh<T>(args: string[]): Promise<T> {
    // `--include` exposes the real response headers at this boundary; `--paginate` interleaves a header block per
    // page, so paginated reads keep the headerless form.
    const headers = args[0] === 'api' && !args.includes('--paginate')
    const output = await this.run(this.deployment.github.cli, headers ? [...args, '--include'] : args, undefined, { responseHeaders: headers })
    try { return JSON.parse(headers ? splitResponseHeaders(output).body : output) as T }
    catch {
      // Never echo the output, which may hold remote content; a SyntaxError would otherwise be parked as a permanent programming error.
      const failure = new CliError('gh returned output that is not valid JSON')
      failure.unreadable = true
      throw failure
    }
  }
  /**
   * Calls the GitHub API on a path within the configured repository, validating JSON output when a schema is provided
   * or returning raw CLI output (such as raw files or `--include` headers) when omitted.
   * @throws CliError with GitHub's HTTP status as `code` on failure.
   */
  async api<T>(schema: z.ZodType<T>, path: string, ...flags: string[]): Promise<T>
  async api(path: string, ...flags: string[]): Promise<string>
  async api<T>(schema: z.ZodType<T> | string, ...rest: string[]): Promise<T | string> {
    if (typeof schema === 'string') return this.run(this.deployment.github.cli, ['api', this.path(schema), ...rest])
    const [path = '', ...flags] = rest
    return schema.parse(await this.gh(['api', this.path(path), ...flags]))
  }
  /** Fetches all pages of a GitHub API list within the configured repository, skipping items that fail schema validation. */
  async pages<T>(item: z.ZodType<T>, path: string, tally?: Tally): Promise<T[]> {
    const resource = this.path(path)
    try {
      const pages = z.array(z.array(z.unknown())).parse(await this.gh(['api', resource, '--paginate', '--slurp']))
      return validItems(item, pages.flat(), tally)
    } catch (error) {
      // The whole history exceeded the subprocess output cap, so retrying the same slurp can never progress: read one bounded page per call instead.
      if (!(error instanceof CliError && error.oversized)) throw error
      return validItems(item, await this.pagewise(resource), tally)
    }
  }
  /** Reads a list endpoint one page per subprocess call (same gh account, same repository-scoped path), so memory is bounded by one page. */
  private async pagewise(resource: string): Promise<unknown[]> {
    const [base = '', query = ''] = resource.split('?', 2)
    const params = new URLSearchParams(query)
    const perPage = Math.min(100, Math.max(1, Number(params.get('per_page')) || 100))
    params.set('per_page', String(perPage))
    const all: unknown[] = []
    // Callers that already read earlier pages pass `page=N`; continue from there exactly as `--paginate` would.
    const start = Math.max(1, Math.floor(Number(params.get('page'))) || 1)
    for (let page = start; page < start + MAX_PAGES; page++) {
      params.set('page', String(page))
      const batch = z.array(z.unknown()).parse(await this.gh(['api', `${base}?${params}`]))
      all.push(...batch)
      if (batch.length < perPage) return all
    }
    throw new CliError(`more than ${MAX_PAGES} pages; refusing to read an unbounded history`)
  }
  private path(path: string): string {
    const outside = /^\/|^[a-z]+:|(^|\/)\.\.?(\/|\?|$)/i.test(path)
    if (outside) throw new Error('GitHub calls are restricted to the configured repository')
    return path ? `repos/${this.repository}/${path}` : `repos/${this.repository}`
  }
  /**
   * Runs the Feishu bot's `lark-cli` and returns the JSON `data` payload.
   * @throws CliError with Feishu's error code on failure (rewriting 232011 when the bot is not in the chat).
   */
  async lark<T>(args: string[], cwd?: string): Promise<T> {
    const bot = this.deployment.feishu
    if (!bot) throw new Error('The Feishu Source has no working bot CLI')
    const output = await this.run(bot.cli, [...args, '--as', 'bot', '--format', 'json'], cwd, { errorEnvelope: true })
      .catch((error: unknown) => { throw membership(error) })
    const result = JSON.parse(output) as { ok: boolean; data: T; error?: { code?: number; message?: string } }
    const code = result.error?.code
    if (!result.ok) throw membership(new CliError(`${result.error?.message ?? 'Feishu command failed'}${code ? ` (${code})` : ''}`, code))
    return result.data
  }
  /** Runs `git` on PATH using the agent's isolated git environment and credential helper. */
  async git(args: string[], cwd: string): Promise<string> { return this.run('git', args, cwd) }
}
