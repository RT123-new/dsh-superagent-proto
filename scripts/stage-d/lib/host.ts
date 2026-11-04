/**
 * Vi-free Source host for Stage D benchmark scripts — the same wiring as tests/fixtures/source-host.ts (real SQLite
 * Store, Engine, SourceRegistry with the github kind) but without vitest, so standalone node scripts can drive the
 * real polling code offline. Mock transport calls are plain monkey-patches recorded by the caller.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type Assessor, type Executor, type Trigger, type OutboundMessage, type ReceiveResult }
  from '../../../src/core/index.ts'
import { Store } from '../../../src/app/store.ts'
import { SettingsSchema, settingsPolicy } from '../../../src/policy.ts'
import { SourceRegistry } from '../../../src/sources/registry.ts'
import { githubKind } from '../../../src/sources/github.ts'
import { Commands } from '../../../src/infra/commands.ts'
import { HealthBoard } from '../../../src/infra/health.ts'
import { sourceContextOf, type SourceContextDeps } from '../../../src/app/source-context.ts'
import { testDeployment } from '../../../tests/fixtures/deployment.ts'

export function sourceHost(dir: string, overrides: Partial<SourceContextDeps> = {}) {
  const store = new Store(join(dir, 'db.sqlite'))
  const settings = SettingsSchema.parse({ policy: { sources: { github: { allowed: [{ id: 'alice' }] } } }, eval: { mode: 'auto' } })
  store.saveSettings(settings)
  const board = new HealthBoard()
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(githubKind)
  const deployment = overrides.deployment ?? testDeployment()
  const assessor: Assessor = { request: async () => {} }
  const executor: Executor = { start: async () => {}, deliver: async () => {}, stop: async () => {} }
  const outbox = { send: (_message: OutboundMessage) => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const results: ReceiveResult[] = []
  const received: Trigger[] = []
  const receive = async (trigger: Trigger) => {
    const result = engine.receive(trigger)
    results.push(result)
    received.push(trigger)
    engine.evaluateDue()
    return result
  }
  const parts: SourceContextDeps = { store, engine, outbox, commands, sources, deployment,
    ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  const context = sourceContextOf(parts, { kind: 'github', health: ['github'] })
  return { dir, ...parts, ...context, health: board.all, store, engine, commands, receive, results, received }
}
export type BenchHost = ReturnType<typeof sourceHost>
export const hostDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))
export function closeHost(h: BenchHost): void {
  h.store.close()
  rmSync(h.dir, { recursive: true, force: true })
}
/** Replaces a method with a plain function (the benchmark's mock transport), returning a restore function. */
export function stub<T extends object, K extends keyof T>(target: T, method: K, impl: T[K]): () => void {
  const original = target[method]
  target[method] = impl
  return () => { target[method] = original }
}
