/** Final review phase 2.4: operator routes for blocked effects, on a real Effects queue behind the real same-origin management router. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { registerHttp } from '../src/app/http.ts'
import type { HttpHost } from '../src/app/http.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'

type H = (req: unknown, res: unknown) => Promise<void>
const dirs: string[] = [], stores: Store[] = []
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const SECRET = 'sk-live-SECRET-remote-text-1234'
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'routes-')); dirs.push(dir)
  const store = new Store(join(dir, 'o.sqlite'), () => {}); stores.push(store)
  let clock = 1_000_000
  const effects = new Effects(store, new HealthBoard(), () => clock)
  const fail = { on: true }, hold: { enter?: () => void; gate?: Promise<void> } = {}
  effects.handle('relay', async () => { if (hold.gate) { hold.enter?.(); await hold.gate }; if (fail.on) throw Object.assign(new Error(`bad request ${SECRET}`), { status: 400 }) }, { ordered: true })
  let handler: H = async () => {}
  registerHttp({ webServer: { host: '127.0.0.1', port: 3082, register: (r: { handler: H }) => { handler = r.handler; return () => {} } } } as never,
    { ready: Promise.resolve(), effects } as unknown as HttpHost)
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string | undefined> = {}) => {
    let status = 0, text = ''
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const sent = Object.fromEntries(Object.entries({ host: '127.0.0.1:3082', 'x-orchestrator-request': '1', ...headers }).filter(([, v]) => v !== undefined))
    await handler({ method, url: `/orchestrator/api/${path}`, headers: sent, async *[Symbol.asyncIterator]() { yield* chunks } },
      { writeHead: (c: number) => { status = c }, end: (d: string) => { text = d } })
    return { status, text, body: JSON.parse(text) as Record<string, unknown> }
  }
  const tick = async () => { clock += 5_000_000; effects.kick(); await new Promise(r => setTimeout(r, 40)) }
  return { store, effects, call, fail, tick, hold }
}

it('GET effects/blocked returns the safe class and counters only: no stored error text, no payload', async () => {
  const { store, effects, call, tick } = setup()
  store.atomic(() => { effects.enqueue('relay', 'head', { text: `payload ${SECRET}` }) })
  effects.start(); await tick(); await tick()
  expect(effects.blocked('relay')[0]!.error).toContain(SECRET.slice(0, 4))      // the stored row is not the surface
  const res = await call('GET', 'effects/blocked')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ items: [{ kind: 'relay', key: 'head', class: 'permanent', attempts: expect.any(Number), since: expect.any(String), attemptUnknown: false }] })
  expect(res.text).not.toContain('SECRET'); expect(res.text).not.toContain('payload'); expect(res.text).not.toContain('bad request')
})

it('both routes keep the same-origin and loopback controls', async () => {
  const { call } = setup()
  for (const [method, path, body] of [['GET', 'effects/blocked', undefined], ['POST', 'effects/relay/rearm', { key: 'head' }]] as const) {
    for (const headers of [{ 'x-orchestrator-request': undefined }, { host: 'evil.example:3082' }, { origin: 'http://evil.example' }]) {
      expect(await call(method, path, body, headers), `${method} ${JSON.stringify(headers)}`).toMatchObject({ status: 403 })
    }
  }
})

it('POST rearm takes kind and key explicitly: unknown kind 404, unknown key rearmed:false, extra or missing fields 400; there is no discard route', async () => {
  const { store, effects, call, tick } = setup()
  store.atomic(() => { effects.enqueue('relay', 'head', { text: 'a' }) })
  effects.start(); await tick(); await tick()
  expect(await call('POST', 'effects/nope/rearm', { key: 'head' })).toMatchObject({ status: 404 })
  expect(await call('POST', 'effects/relay/rearm', { key: 'missing' })).toMatchObject({ status: 200, body: { rearmed: false } })
  expect(await call('POST', 'effects/relay/rearm', {})).toMatchObject({ status: 400 })
  expect(await call('POST', 'effects/relay/rearm', { key: 'head', discard: true })).toMatchObject({ status: 400 })
  for (const path of ['effects/relay/discard', 'effects/relay/cancel', 'effects/blocked/head']) expect((await call('POST', path, { key: 'head' })).status).toBe(404)
  expect(effects.blocked('relay')).toHaveLength(1)                                // nothing changed by the refused calls
})

it('POST rearm re-enqueues the blocked row once, explicitly; a second call finds nothing to rearm', async () => {
  const { store, effects, call, fail, tick } = setup()
  store.atomic(() => { effects.enqueue('relay', 'head', { text: 'a' }) })
  effects.start(); await tick(); await tick()
  fail.on = false; await tick()
  expect(effects.blocked('relay')).toHaveLength(1)                                // never automatic
  expect(await call('POST', 'effects/relay/rearm', { key: 'head' })).toMatchObject({ status: 200, body: { rearmed: true } })
  await tick(); await tick()
  expect(effects.pending('relay', 'head')).toBe(false)
  expect(await call('POST', 'effects/relay/rearm', { key: 'head' })).toMatchObject({ body: { rearmed: false } })
})

it('POST rearm refuses (rearmed:false) while that row\'s attempt is in flight', async () => {
  const { store, effects, call, fail, tick, hold } = setup()
  store.atomic(() => { effects.enqueue('relay', 'head', { text: 'a' }) })
  effects.start(); await tick(); await tick()
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  hold.enter = () => entered.resolve(); hold.gate = gate.promise
  fail.on = false
  expect(await call('POST', 'effects/relay/rearm', { key: 'head' })).toMatchObject({ body: { rearmed: true } })
  effects.kick(); await entered.promise
  expect(await call('POST', 'effects/relay/rearm', { key: 'head' })).toMatchObject({ body: { rearmed: false } })
  gate.resolve(); await tick()
})
