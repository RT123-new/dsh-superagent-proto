/** Subprocess wrapper for running gh, lark-cli, and git commands under the deployment's configured accounts. */
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Deployment } from '../deployment.ts'
import { githubResponse, githubNext, type GithubResponse } from './github-response.ts'
import { TransportFailure } from './transport-failure.ts'
import { Probe } from './metrics-probe.ts'

const exec = promisify(execFile)
const TIMEOUT_MS = 90_000
/**
 * Error thrown by Commands when a CLI invocation fails, capturing stderr diagnostics, API error codes, and exit status without echoing command arguments.
 * Source channels and pollers inspect its code to distinguish deleted conversations from retryable failures.
 */
export class CliError extends Error {
  constructor(message: string, readonly code?: number, readonly exitCode?: number, readonly transportFailure?: TransportFailure) { super(message) }
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
  return new CliError(`${basename(program)} ${ended(error)}`, undefined, exitCode)
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
export interface Tally { skipped: number }
/** Parses array elements against a schema, skipping invalid items and incrementing `tally.skipped`. */
export function validItems<T>(item: z.ZodType<T>, list: readonly unknown[], tally?: Tally): T[] {
  const items = list.flatMap(value => { const parsed = item.safeParse(value); return parsed.success ? [parsed.data] : [] })
  if (tally) tally.skipped += list.length - items.length
  return items
}
/** Rewrites Feishu error 232011 (bot not in chat) with remediation instructions. */
function membership(error: unknown): unknown {
  if (!(error instanceof CliError) || error.code !== 232011) return error
  const hint = 'The Feishu bot is not a member of the chat. Add the bot in the chat settings, then retry.'
  return new CliError(hint, error.code, error.exitCode)
}
/**
 * Executes gh, lark-cli, and git subprocesses with deployment account credentials, timeouts, and abort signals.
 * Restricts GitHub API calls to the configured repository and translates CLI failures into CliError instances for Sources, MasterAssessor, Outbox, and Settings.
 */
export interface RequestControl {
  before(signal: AbortSignal): Promise<void>
  after(response: GithubResponse): void
}
/** Executes commands under the resolved deployment identity; opt-in controls preserve per-page HTTP metadata. */
export class Commands {
  /**
   * @param resolved - returns the resolved deployment setup, or throws while setup is still pending.
   * @param environment - variables overriding `process.env` for every command (such as isolated git settings).
   */
  constructor(private readonly resolved: () => Deployment, private readonly environment: Record<string, string | undefined>, private readonly signal: AbortSignal, private readonly probe: Probe = new Probe(undefined), private readonly requestControl?: RequestControl) {}
  get deployment(): Deployment { return this.resolved() }
  get repository(): string { return this.deployment.repository }
  withSignal(signal?: AbortSignal): Commands { return signal ? new Commands(this.resolved, this.environment, AbortSignal.any([this.signal, signal]), this.probe, this.requestControl) : this }
  withRequestControl(control: RequestControl): Commands {
    return new Commands(this.resolved, this.environment, this.signal, this.probe, control)
  }
  private async execute(program: string, args: string[], cwd?: string): Promise<string> {
    const stop = this.probe.timer('command_run', 'internal')
    try {
      const { stdout } = await exec(program, args, { cwd, signal: this.signal, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...this.environment, GH_PROMPT_DISABLED: '1', LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } })
      stop(); return stdout
    } catch (error) { stop('failed'); throw error }
  }
  async run(program: string, args: string[], cwd?: string): Promise<string> {
    try { return await this.execute(program, args, cwd) }
    catch (error) { throw commandError(error, program) }
  }
  /** Additive per-page metadata seam. Uses only the deployment's configured CLI/account. No automatic retry. */
  async apiResponse(path: string, ...flags: string[]): Promise<GithubResponse> {
    const scoped = this.path(path)
    await this.requestControl?.before(this.signal)
    this.signal.throwIfAborted()
    let response: GithubResponse
    try {
      response = githubResponse(await this.execute(this.deployment.github.cli, ['api', scoped, '--include', ...flags.filter(f => f !== '--include')]))
    } catch (error) {
      const converted = commandError(error, this.deployment.github.cli)
      if (converted.name === 'AbortError') throw converted
      // gh includes the actual HTTP block in stdout on HTTP failures. stderr/body text alone grants no metadata.
      const stdout = error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : undefined
      let failed: GithubResponse | undefined
      try { if (stdout) failed = githubResponse(stdout) } catch { /* retain sanitized CLI error without invented headers */ }
      if (!failed || failed.status < 300) throw converted
      this.requestControl?.after(failed)
      throw new CliError(converted.message, failed.status, converted instanceof CliError ? converted.exitCode : undefined,
        new TransportFailure(converted.message, { status: failed.status, retryAfter: failed.headers['retry-after'] }, Date.now()))
    }
    this.requestControl?.after(response)
    if (response.status >= 300) throw new CliError(`GitHub HTTP ${response.status}`, response.status, undefined,
      new TransportFailure(`GitHub HTTP ${response.status}`, {status: response.status, retryAfter: response.headers['retry-after']}, Date.now()))
    return response
  }
  /** Runs the agent's GitHub CLI and parses its JSON output; callers should prefer `api`, which is restricted to the configured repository and validates output. */
  async gh<T>(args: string[]): Promise<T> { return JSON.parse(await this.run(this.deployment.github.cli, args)) as T }
  /**
   * Calls the GitHub API on a path within the configured repository, validating JSON output when a schema is provided
   * or returning raw CLI output (such as raw files or `--include` headers) when omitted.
   * @throws CliError with GitHub's HTTP status as `code` on failure.
   */
  async api<T>(schema: z.ZodType<T>, path: string, ...flags: string[]): Promise<T>
  async api(path: string, ...flags: string[]): Promise<string>
  async api<T>(schema: z.ZodType<T> | string, ...rest: string[]): Promise<T | string> {
    if (this.requestControl) {
      const path = typeof schema === 'string' ? schema : rest.shift() ?? ''
      const response = await this.apiResponse(path, ...rest)
      if (typeof schema !== 'string') return schema.parse(JSON.parse(response.body))
      return rest.includes('--include') ? `HTTP/2.0 ${response.status} OK\r\n${Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${response.body}` : response.body
    }
    if (typeof schema === 'string') return this.run(this.deployment.github.cli, ['api', this.path(schema), ...rest])
    const [path = '', ...flags] = rest
    return schema.parse(await this.gh(['api', this.path(path), ...flags]))
  }
  /** Fetches all pages of a GitHub API list within the configured repository, skipping items that fail schema validation. */
  async pages<T>(item: z.ZodType<T>, path: string, tally?: Tally): Promise<T[]> {
    if (this.requestControl) {
      const out: T[] = [], seen = new Set<string>()
      let next: string | undefined = path
      while (next !== undefined) {
        if (seen.has(next)) throw new Error('GitHub repeated a pagination link')
        seen.add(next)
        const response = await this.apiResponse(next)
        out.push(...validItems(item, z.array(z.unknown()).parse(JSON.parse(response.body)), tally))
        next = githubNext(response.headers, this.repository)
      }
      return out
    }
    const pages = z.array(z.array(z.unknown())).parse(await this.gh(['api', this.path(path), '--paginate', '--slurp']))
    return validItems(item, pages.flat(), tally)
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
    const output = await this.run(bot.cli, [...args, '--as', 'bot', '--format', 'json'], cwd)
      .catch((error: unknown) => { throw membership(error) })
    const result = JSON.parse(output) as { ok: boolean; data: T; error?: { code?: number; message?: string } }
    const code = result.error?.code
    if (!result.ok) throw membership(new CliError(`${result.error?.message ?? 'Feishu command failed'}${code ? ` (${code})` : ''}`, code))
    return result.data
  }
  /** Runs `git` on PATH using the agent's isolated git environment and credential helper. */
  async git(args: string[], cwd: string): Promise<string> { return this.run('git', args, cwd) }
}
