/** Preparation owns every child in its managed range, not only the direct shell.
 * Keep this stronger lifetime policy local: ordinary source/verification reads do not own setup jobs.
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { CliError } from '../infra/commands.ts'

export async function runPreparationCommand(runtime: SubprocessRuntime, argv: string[], cwd: string,
  signal: AbortSignal, env: Record<string, string>): Promise<void> {
  signal.throwIfAborted()
  const handle = runtime.spawn({ argv, cwd, graceMs: 2000, signal, env,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 16 } } })
  let failure: unknown
  let exitCode: number | null = null
  try { ({ exitCode } = await handle.done) }
  catch (error) { failure = error; handle.terminate() }
  try {
    // Do not pass the already-aborted assignment signal: it starts teardown but must not cancel its wait.
    if (!await handle.waitForExit()) throw new Error('Managed range wait ended without quiescence')
  } catch (error) {
    handle.terminate()
    throw new PreparationQuiescenceUnknown(`Cannot prove preparation process range stopped: ${String(error)}`)
  }
  if (failure) throw failure
  signal.throwIfAborted()
  if (exitCode !== 0) throw new CliError(handle.collected.stderr?.readFrom(0).text.trim()
    || `The prepare command ${exitCode === null ? 'was stopped' : `exited with ${exitCode}`}`, undefined, exitCode ?? undefined)
}

/** This is not an ordinary failed command: reuse must remain blocked until process ownership is resolved. */
export class PreparationQuiescenceUnknown extends Error {}
