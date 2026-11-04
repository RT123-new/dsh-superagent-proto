/** GitHub outbound channel: posts issue/PR comments and review thread replies under the agent account. */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import { checkedMessageId, SendNotAttempted } from './send.ts'
import { sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { githubAddress, githubPage } from './github-trigger.ts'

const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), in_reply_to_id: z.number().nullish(), user: z.looseObject({ login: z.string() }).nullish(),
})
/** True when an issue is permanently deleted (410) or locked (403); 404 is retried because it can indicate temporary permission loss on a private repo. */
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 410 || (error.code === 403 && /locked/i.test(error.message)))
const missing = (error: unknown): boolean => error instanceof CliError && (error.code === 404 || error.code === 410)
/** Posts a comment or review-thread reply with an embedded HTML marker so retries do not create duplicate comments. */
export async function sendGithub(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { commands } = host
  const { repository, github } = commands.deployment
  const number = Number(message.channel.address.number)
  if (!number) throw new SendNotAttempted('Missing GitHub reply target', true)
  const marker = `<!-- dsh-superagent:${checkedMessageId(message.id)} -->`
  try {
    // Retained trigger URLs also route replies queued before thread-aware delivery.
    // Every failure before the POST is provably not-attempted (read-only calls) and may retry automatically.
    const address = githubAddress(message.channel.address.url ?? '', repository)
    let rootId: number | undefined
    if (address?.pr && address.discussion && address.number === number) {
      // Fall back to a top-level PR comment if the target inline review comment was deleted.
      const source = await commands.api(CommentSchema, `pulls/comments/${address.discussion}`)
        .catch((error: unknown) => {
          if (missing(error)) return undefined
          // A permanently gone target keeps its settlement; every other pre-POST read failure is provably not-attempted.
          if (gone(error)) throw error
          throw new SendNotAttempted(error instanceof Error ? error.message : String(error), false, error)
        })
      rootId = source ? source.in_reply_to_id ?? source.id : undefined
    }
    const path = rootId === undefined ? `issues/${number}/comments` : `pulls/${number}/comments`
    const mine = (comment: z.infer<typeof CommentSchema>) => sameName(comment.user?.login ?? '', github.login)
      && (rootId === undefined || comment.in_reply_to_id === rootId) && (comment.body ?? '').includes(marker)
    let posted: boolean
    try { posted = (await commands.pages(CommentSchema, path)).some(mine) }
    catch (error) {
      // A permanently gone target keeps its settlement; every other pre-POST failure is provably not-attempted.
      if (gone(error)) throw error
      throw new SendNotAttempted(error instanceof Error ? error.message : String(error), false, error)
    }
    if (posted) return 'sent'
    const target = rootId === undefined ? path : `${path}/${rootId}/replies`
    // Past this point the request may have been accepted: a failure here is an unknown outcome, parked unless the
    // channel proves idempotency (GitHub does not); an acknowledged operator rearm re-checks the marker and converges.
    await commands.api(z.unknown(), target, '--method', 'POST', '-f', `body=${message.text}\n\n${marker}`)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}
export function githubLink(address: Record<string, string>, links: ChannelLinks): ChannelLink {
  const number = address.number ?? ''
  const review = !!links.repository && !!githubAddress(address.url ?? '', links.repository)?.discussion
  return { url: address.url ?? (links.repository ? githubPage(links.repository, Number(number)) : ''),
    label: review ? { zh: `GitHub #${number} 的 review 讨论`, en: `Review discussion on GitHub #${number}` }
      : { zh: `GitHub #${number}`, en: `GitHub #${number}` } }
}
