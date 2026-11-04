import { createRoot } from 'react-dom/client'
import { App } from '../src/client/app.tsx'
import { usePageForm } from '../src/client/deployment.tsx'
import { en, zh } from '../src/client/locales.ts'
import { server, startFakeServer } from './panel-server.ts'
const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'en' ? en : zh
const t = ((key: string, p?: Record<string, unknown>) => { const tpl = (lang as any)[key] ?? key; return p ? tpl.replace(/\{(\w+)\}/g, (m: string, n: string) => n in p ? String(p[n]) : m) : tpl }) as any
startFakeServer()
const unknown = params.get('unknown') !== '0'
server.blockedEffects = [
  { kind: 'relay', key: 'r1', class: 'permanent', attempts: 3, since: '2026-09-22T00:00:00Z', attemptUnknown: unknown },
  { kind: 'relay', key: 'r2-a-very-long-key-' + 'x'.repeat(80), class: 'rate_limited', attempts: 12, since: '2026-09-22T00:00:00Z', attemptUnknown: false },
]
sessionStorage.setItem('dsh-superagent/route', JSON.stringify({ route: { page: 'execution' }, stack: [] }))
function Panel() { return <App t={t} openSession={async () => {}} deploymentForm={usePageForm(server.form)} /> }
createRoot(document.getElementById('root')!).render(<Panel />)
