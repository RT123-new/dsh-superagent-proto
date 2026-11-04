/** Isolated candidate adapter. Calls actual source pollThreads per singleton subscription.
 * Source-level phase orchestration and shared notification/PR dedupe are deliberately not changed.
 */
import { pollThreads } from '../../../src/sources/github.ts'
import type { SourceContext } from '../../../src/sources/host.ts'
export async function boundedPool<T>(items: readonly T[], concurrency: number, stopped: () => boolean,
  work: (item: T) => Promise<void>): Promise<void> {
  if (![1,2,4,8].includes(concurrency)) throw new Error('unsupported concurrency')
  let next = 0
  async function worker(): Promise<void> {
    while (!stopped()) {
      const index = next++
      if (index >= items.length) return
      await work(items[index]!)
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => worker()))
}
export async function pooledSubscriptions(ctx: SourceContext, concurrency: number, signal: AbortSignal): Promise<void> {
  const subscriptions = [...ctx.threads.subscribed('github')]
  await boundedPool(subscriptions, concurrency, () => signal.aborted || !ctx.config('github'), async thread => {
    const isolated: SourceContext = { ...ctx, threads: { ...ctx.threads, subscribed: () => [thread] } }
    await pollThreads(isolated, signal)
  })
}
