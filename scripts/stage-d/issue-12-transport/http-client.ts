/** Loopback-only candidate study. NOT account-equivalent to arbitrary gh wrappers. No production adoption.
 * Dummy token only. Pagination here handles consecutive numeric pages, not arbitrary GitHub Link URLs.
 * Redirect, credential resolution, audit, error-body and timeout equivalence are NOT certified. */
import { CliError } from '../../../src/infra/commands.ts'
import { z } from 'zod'

const TIMEOUT_MS = 90_000 // matches Commands

export interface RawResponse { status: number; headers: Record<string, string>; body: string }

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly repository: string,
    private readonly token: string,
    private readonly signal?: AbortSignal,
  ) {}
  /** Same scoping rule as Commands.path: only paths inside the configured repository. */
  private path(path: string): string {
    const outside = /^\/|^[a-z]+:|(^|\/)\.\.?(\/|\?|$)/i.test(path)
    if (outside) throw new Error('GitHub calls are restricted to the configured repository')
    return path ? `repos/${this.repository}/${path}` : `repos/${this.repository}`
  }
  private async request(rawPath: string, conditionalEtag?: string): Promise<RawResponse> {
    const signal = AbortSignal.any([...(this.signal ? [this.signal] : []), AbortSignal.timeout(TIMEOUT_MS)])
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/${this.path(rawPath)}`, {
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28', ...(conditionalEtag ? { 'if-none-match': conditionalEtag } : {}) },
        signal, redirect: 'error',
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new CliError(`timed out after ${TIMEOUT_MS / 1000} s`)
      throw error
    }
    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => { headers[name] = value })
    // Same interpretation as commandError: non-2xx (including 304) becomes a CliError carrying the HTTP status.
    if (response.status < 200 || response.status >= 300) throw new CliError(`HTTP ${response.status}`, response.status)
    return { status: response.status, headers, body }
  }
  /** Raw variant matching `commands.api(path, '--include')`: returns the header block and body as one string. */
  async apiRaw(path: string, etag?: string): Promise<string> {
    const { headers, body } = await this.request(path, etag)
    const block = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')
    return `HTTP/2.0 200 OK\r\n${block}\r\n\r\n${body}`
  }
  async api<T>(schema: z.ZodType<T>, path: string): Promise<T> {
    return schema.parse(JSON.parse((await this.request(path)).body))
  }
  /** Same pagination contract as Commands.pages: follow Link rel="next" from page 2, validate, skip invalid items. */
  async pages<T>(item: z.ZodType<T>, path: string): Promise<T[]> {
    const out: T[] = []
    let page = 1
    for (;;) {
      const { headers, body } = await this.request(page === 1 ? path : `${path}${path.includes('?') ? '&' : '?'}page=${page}`)
      const list = z.array(z.unknown()).parse(JSON.parse(body))
      for (const value of list) {
        const parsed = item.safeParse(value)
        if (parsed.success) out.push(parsed.data)
      }
      if (!/rel="next"/.test(headers.link ?? '')) return out
      page += 1
    }
  }
}
