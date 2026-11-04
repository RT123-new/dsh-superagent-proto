import './bootstrap.mjs'
/** Real-browser harness: mounts the actual panel App against the typed fixture server, for pixel evidence. */
import { createRoot } from 'react-dom/client'
import { App } from '../../src/client/app.tsx'
import { usePageForm } from '../../src/client/deployment.tsx'
import { zh, en } from '../../src/client/locales.ts'
import type { T } from '../../src/client/text.ts'
import { server, usePanelServer } from '../../tests/fixtures/panel-server.ts'

declare global {
  interface Window {
    __server: typeof server
    __seedBlocked: (n: number) => void
    __slowBlocked: boolean
    __lang: (dictionary: Record<string, string>) => void
  }
}

usePanelServer(() => {})

const translator = (dictionary: Record<string, string>): T => ((key: string, params?: Record<string, unknown>) => {
  const template = dictionary[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match) : template
}) as T

function Panel({ dictionary }: { dictionary: Record<string, string> }) {
  return <App t={translator(dictionary)} openSession={async id => { server.opened.push(id) }} deploymentForm={usePageForm(server.form)} />
}

// Artificial latency knob for the loading-state shot: delays only the blocked-effects poll.
const baseFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (window.__slowBlocked && String(input).includes('effects/blocked')) await new Promise(resolve => setTimeout(resolve, 3000))
  return baseFetch(input, init)
}) as typeof fetch

window.__server = server
window.__slowBlocked = false
window.__seedBlocked = (n: number) => {
  server.blockedEffects = Array.from({ length: n }, (_, i) => ({ kind: 'relay', key: `r${i}`, class: i % 7 === 0 ? 'unknown' : 'permanent',
    attempts: 1 + (i % 3), since: '2026-09-22T00:00:00Z', attemptUnknown: i % 7 === 0, generation: 1 }))
}

// Scenario knobs via query params: ?seed=N blocked rows (default 450), ?slow=1 delays the blocked poll (loading state),
// ?down=1 makes every request fail (error state), ?lang=en switches the dictionary.
const scenario = new URLSearchParams(location.search)
window.__slowBlocked = scenario.get('slow') === '1'
window.__seedBlocked(Number(scenario.get('seed') ?? 450))
if (scenario.get('down') === '1') server.down = true
const downPaths = scenario.get('downpaths')
if (downPaths) server.downPaths = downPaths.split(',')
sessionStorage.setItem('dsh-superagent/route', JSON.stringify({ route: { page: 'execution' }, stack: [] }))
const container = document.getElementById('root')!
let root = createRoot(container)
root.render(<Panel dictionary={scenario.get('lang') === 'en' ? en : zh} />)
window.__lang = (dictionary: Record<string, string>) => { root.render(<Panel dictionary={dictionary} />) }
;(window as unknown as { __dictionaries: unknown }).__dictionaries = { zh, en }
