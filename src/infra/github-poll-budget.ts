/** Shared per-source GitHub request reservations. Primary-rate heuristic is not secondary-limit immunity. */
import type { RequestControl } from './commands.ts'
import type { GithubResponse } from './github-response.ts'
import { serverNotBefore } from './transport-failure.ts'
/** Serializes request permits and folds verified rate/retry headers without increasing the configured pool. */
export class GithubPollBudget implements RequestControl {
  private inFlight = 0
  private next = 0
  private lastGranted?: number
  private blocked = 0
  private remaining?: number
  private allowance?: number
  private reset?: number
  constructor(private readonly fallbackPerSecond = 10, private readonly now = () => Date.now(),
    private readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve,reject) => {
      if(signal.aborted){reject(signal.reason);return}
      const stop=()=>{clearTimeout(timer);reject(signal.reason)}
      const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},ms)
      signal.addEventListener('abort',stop,{once:true})
    })) {
    if(!Number.isFinite(fallbackPerSecond)||fallbackPerSecond<=0||fallbackPerSecond>10)throw new Error('Invalid conservative GitHub fallback rate')
  }
  private tail: Promise<void> = Promise.resolve()
  before(signal: AbortSignal): Promise<void> {
    const turn = this.tail.then(() => this.grant(signal))
    this.tail = turn.catch(() => {})
    return turn
  }
  private async grant(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted()
      const now = this.now()
      if (this.reset !== undefined && now >= this.reset) { this.remaining = undefined; this.allowance = undefined; this.reset = undefined }
      let spacing = 1000 / this.fallbackPerSecond
      if (this.remaining !== undefined && this.allowance !== undefined && this.reset !== undefined) {
        const reserve = Math.max(10, Math.ceil(.1 * this.allowance))
        const rate = Math.max(0, (this.remaining - reserve) / Math.max(1, (this.reset - now) / 1000))
        if (rate === 0) this.blocked = Math.max(this.blocked, this.reset)
        else spacing = Math.max(spacing, 1000 / rate)
      }
      const at = Math.max(this.next, this.blocked, this.lastGranted === undefined ? 0 : this.lastGranted + spacing)
      if (at > now) { await this.sleep(Math.ceil(at - now), signal); continue }
      this.inFlight += 1
      this.lastGranted = now
      this.next = now + spacing
      if (this.remaining !== undefined) this.remaining = Math.max(0, this.remaining - 1)
      return
    }
  }
  after(response: GithubResponse): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const now=this.now(), h=response.headers
    const retry=serverNotBefore(h['retry-after'],now)
    const pollInterval=serverNotBefore(h['x-poll-interval'],now)
    if(pollInterval!==undefined)this.blocked=Math.max(this.blocked,pollInterval)
    if(retry!==undefined)this.blocked=Math.max(this.blocked,retry)
    const int=(s:string|undefined)=>s!==undefined&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))?Number(s):undefined
    const remaining=int(h['x-ratelimit-remaining']),allowance=int(h['x-ratelimit-limit']),resetSeconds=int(h['x-ratelimit-reset'])
    const reset=resetSeconds===undefined?undefined:resetSeconds*1000
    if(remaining!==undefined&&allowance!==undefined&&reset!==undefined&&reset>now&&Number.isSafeInteger(reset)&&(this.reset===undefined||reset>=this.reset)){
      // Out-of-order responses in one window never replenish reservations.
      this.remaining=this.reset===reset&&this.remaining!==undefined?Math.min(this.remaining,Math.max(0,remaining-this.inFlight)):Math.max(0,remaining-this.inFlight)
      this.allowance=allowance;this.reset=reset
      if(remaining<=Math.max(10,Math.ceil(.1*allowance)))this.blocked=Math.max(this.blocked,reset)
    }
    // Unknown secondary-limit response without Retry-After: stop this source's dispatch for a conservative minute.
    if((response.status===403||response.status===429)&&retry===undefined)this.blocked=Math.max(this.blocked,now+60_000)
  }
}
