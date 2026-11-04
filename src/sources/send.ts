/**
 * Outcome contracts for outbound channel sends (mandate section 3B). A channel distinguishes, where its provider
 * contract permits: definitely not attempted (SendNotAttempted / Later), definitively rejected ('gone'), acknowledged
 * ('sent'), and outcome unknown (any other failure after a possible provider invocation). Acceptance or rejection is
 * never inferred from an exception message alone.
 */
/** How a channel makes a retried send safe after an ambiguous failure. */
export type SendIdempotency =
  /** The provider itself keeps at most one message per durable idempotency key (the message id). */
  | 'provider'
  /** The adapter dedupes application-level: it checks for its own persisted marker (the message id) before posting. */
  | 'marker'
/** Thrown by a channel that can prove no provider request was made (validation or pre-send checks). */
export class SendNotAttempted extends Error {
  /** `cause` is the original provider failure when one exists, so scheduling keeps its classification and typed embargo. */
  constructor(message: string, readonly permanent = false, readonly cause?: unknown) { super(message); this.name = 'SendNotAttempted' }
}
/**
 * Thrown when a send was invoked, its outcome is unknown, and the channel has no proven idempotency: Effects parks the
 * reply exactly like the crash path instead of risking an automatic duplicate.
 */
export class AttemptUnknownError extends Error {
  constructor(readonly cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); this.name = 'AttemptUnknownError' }
}
/** The durable message id doubles as the provider idempotency key and the adapter's dedupe marker; validate format and scope before use. */
export const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export function checkedMessageId(id: string): string {
  if (!MESSAGE_ID.test(id)) throw new SendNotAttempted('The message id is not a valid idempotency key', true)
  return id
}
