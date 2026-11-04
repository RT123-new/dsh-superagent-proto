/** Reliable outbound message delivery backed by persistent receipts and retried reply effects. */
import type { OutboundMessage, Outbox as OutboxPort, ReplyStatus } from '../core/index.ts'
import type { Commands } from '../infra/commands.ts'
import { checkedImText } from '../infra/text.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import { FAILURES_BEFORE_ERROR, Later, type Effects } from './effects.ts'
import type { Store } from './store.ts'
import type { Probe } from '../infra/metrics-probe.ts'

export interface OutboxHost {
  readonly store: Pick<Store, 'atomic' | 'afterCommit' | 'receipts'>
  readonly effects: Pick<Effects, 'enqueue' | 'cancel' | 'handle' | 'idle'> & Partial<Pick<Effects, 'attemptUnknown'>>
  readonly sources: Pick<SourceRegistry, 'instance' | 'channelAllowed' | 'send'>
  readonly commands: Commands
  paused(): boolean
  /** Optional instrumentation; absent means none. */
  readonly probe?: Probe
}

/**
 * Persists outbound channel messages as receipts and delivers them sequentially through `Effects` and `SourceRegistry`.
 * Implements the core `Outbox` port for `Engine` and source contexts, ensuring per-conversation ordering for each ticket until an earlier message fails repeatedly.
 * Messages wait while processing is paused or their source is unavailable, and settle as dropped when the target conversation is ignored or gone.
 */
export class Outbox implements OutboxPort {
  /** Local monotonic stamps of receipts queued by this process, until sent; receipts queued before a restart are not timed. */
  private readonly queued = new Map<string, number>()
  constructor(private readonly host: OutboxHost) {
    host.effects.handle('reply', (_payload, id) => this.deliver(id), { limit: () => host.paused() ? 0 : 1, retry: [5000, 300_000], markAttempt: true })
  }
  /** Record a message receipt and enqueue its delivery effect atomically; duplicate message IDs are ignored. */
  send(message: OutboundMessage): void {
    // Validate IM reply length here; acknowledgements are already validated when decided.
    if (message.kind === 'reply' && message.channel.source === 'feishu') checkedImText(message.text)
    const { store, effects } = this.host
    store.atomic(() => { if (store.receipts.add(message)) {
      effects.enqueue('reply', message.id, {})
      store.afterCommit(() => {
        const at = this.host.probe?.now()
        if (at === undefined) return
        if (this.queued.size >= 5000) { this.queued.delete(this.queued.keys().next().value!); this.host.probe?.count('receipt_timing_dropped') }
        this.queued.set(message.id, at)
      })
    } })
  }
  status(id: string): ReplyStatus | undefined { return this.host.store.receipts.get(id)?.status }
  /** `attempted-unknown` when a send began and the host stopped before recording its outcome: a retry may duplicate the remote message. */
  outcome(id: string): 'sent' | 'pending' | 'attempted-unknown' | 'other' | undefined {
    const status = this.status(id)
    if (status === undefined) return undefined
    if (status === 'sent') return 'sent'
    if (status !== 'pending') return 'other'
    return this.host.effects.attemptUnknown?.('reply', id) ? 'attempted-unknown' : 'pending'
  }
  withdraw(id: string): void {
    const { store, effects } = this.host
    store.atomic(() => { if (store.receipts.withdraw(id)) { effects.cancel('reply', id); store.afterCommit(() => this.queued.delete(id)) } })
  }
  sent(): Promise<void> { return this.host.effects.idle('reply') }
  private async deliver(id: string): Promise<void> {
    const { store, sources, commands } = this.host
    const receipt = store.receipts.get(id)
    if (receipt?.status !== 'pending') { this.queued.delete(id); return }
    if (!sources.instance(receipt.channel.source)?.enabled) throw new Later('The Source is off or not installed')
    // Hold later messages for the same ticket and conversation behind an earlier pending message until it exceeds the failure threshold.
    if (store.receipts.behind(id, FAILURES_BEFORE_ERROR)) throw new Later('An earlier message of this ticket to this conversation waits')
    if (!sources.channelAllowed(receipt.channel)) { store.receipts.settle(receipt, 'channelIgnored'); this.queued.delete(id); return }
    // A permanently unreachable target (such as a recalled message or deleted Issue) settles as `channelGone` so its receipt prevents retries.
    const result = await sources.send(receipt, commands)
    if (result === 'waiting') throw new Later('The Source is not installed')
    store.receipts.settle(receipt, result === 'gone' ? 'channelGone' : 'sent')
    // Receipt queued -> the Source acknowledged the send; a `gone` target is counted apart, never as a response.
    const at = this.queued.get(id); this.queued.delete(id)
    if (result === 'gone') this.host.probe?.count('reply_gone')
    else if (at !== undefined) this.host.probe?.observe('receipt_to_response', 'internal', Math.max(0, (this.host.probe?.now() ?? at) - at))
  }
}
