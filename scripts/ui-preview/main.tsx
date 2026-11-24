/** Real App/stylesheet preview. All API state below is disposable fixture state. */
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@preview/app'
import { en, zh } from '@preview/locales'
import fixtures from './fixtures.json'
import './preview.css'

const initial = structuredClone(fixtures) as Record<string, any>
if (new URLSearchParams(location.search).get('reset') === '1') sessionStorage.removeItem('dsh-superagent/route')
let data = structuredClone(initial)
const originalFetch = window.fetch.bind(window)
const response = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }))
let announce: (text: string) => void = () => {}
const previewMessage = 'Preview only. This action would open the connected host or provider in an installed workspace.'
function clearPreviewSession() {
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index)
    if (key === 'dsh-superagent/route' || key?.startsWith('dsh-superagent/draft/') || key?.startsWith('dsh-superagent/prompts/')) {
      sessionStorage.removeItem(key)
    }
  }
}
window.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  const address = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
  if (!address.pathname.startsWith('/orchestrator/api/')) return originalFetch(input, options)
  const path = decodeURIComponent(address.pathname.slice('/orchestrator/api/'.length))
  const method = options?.method ?? 'GET'
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {}
  if (method === 'GET') {
    if (path === 'search') {
      const query = (address.searchParams.get('q') ?? '').toLowerCase()
      return response({ tickets: data.tickets.items.filter((ticket: any) => ticket.title.toLowerCase().includes(query)),
        threads: data.threads.items.filter((thread: any) => thread.title.toLowerCase().includes(query)), items: [] })
    }
    if (path === 'tickets') {
      const filter = address.searchParams.get('state') ?? 'open'
      let items = filter === 'ended' ? data['tickets?state=ended'].items : data.tickets.items
      if (filter === 'person') items = items.filter((ticket: any) => ticket.stage === 'person')
      if (filter === 'working') items = items.filter((ticket: any) => ticket.stage === 'working')
      if (filter === 'idle') items = items.filter((ticket: any) => ticket.stage === 'idle')
      return response({ items, total: items.length, next_offset: null })
    }
    if (Object.hasOwn(data, path)) return response(data[path])
    return response({ error: 'This record is not included in the preview data.' }, 404)
  }
  announce('Preview updated. No live system was changed.')
  if (path === 'executor/pause') { data.state.paused = !!body.paused; return response({ paused: !!body.paused }) }
  if (path.startsWith('tickets/') && path.endsWith('/stop')) {
    const id = path.split('/')[1]!
    data.tickets.items = data.tickets.items.filter((ticket: any) => ticket.id !== id)
    data.overview.person = data.overview.person.filter((ticket: any) => ticket.id !== id)
    return response({ stopped: true })
  }
  if (path.startsWith('tickets/') && path.endsWith('/retry')) return response({ retried: true })
  if (path.startsWith('triggers/') && path.endsWith('/requeue')) return response({ queued: true })
  if (path.startsWith('decisions/') && path.endsWith('/dismiss')) {
    data.overview.problems = data.overview.problems.filter((problem: any) => problem.decisionId !== path.split('/')[1])
    return response({ dismissed: true })
  }
  if (path.startsWith('threads/') && path.endsWith('/unsubscribe')) {
    const key = path.split('/')[1]!
    data.threads.items = data.threads.items.filter((thread: any) => thread.key !== key)
    return response({ removed: true, thread: key, context_delivery: 'injected' })
  }
  if (path.startsWith('settings/') && method === 'PUT') {
    const block = path.slice('settings/'.length)
    if (block.startsWith('source:')) { const source = data.settings.sources.find((item: any) => item.id === block.slice(7));
      if (source) { source.value = body.value; source.revision++ }
    } else if (data.settings.blocks[block]) { data.settings.blocks[block] = { value: body.value, revision: body.revision + 1 } }
    return response({ revision: body.revision + 1, restarting: false })
  }
  if (path === 'prompts' && method === 'PUT') {
    data.prompts.revision++; data.prompts.current.config = body.config; data.prompts.current.revision = data.prompts.revision
    return response({ revision: data.prompts.revision, context_delivery: 'injected' })
  }
  if (path === 'prompts/preview') {
    announce('Prompt compilation requires the installed host. Editing and inspecting the supplied prompt fixture remain available here.')
    return response({ error: 'Prompt compilation is unavailable in this UI-only preview.' }, 422)
  }
  if (path.endsWith('/labels')) return response({ added: [] })
  if (path === 'setup/check') { announce(previewMessage); return response({ error: 'The installed host performs connection checks. This preview does not contact providers.' }, 422) }
  if (path.startsWith('policy-sync/')) return response({ policy: data.settings.blocks.policy.value.sources[path.split('/')[1]!] })
  if (path.startsWith('effects/')) return response({ rearmed: false })
  return response({ error: 'This operation requires the installed host.' }, 422)
}) as typeof fetch

function Preview() {
  const params = new URLSearchParams(location.search)
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [language, setLanguage] = useState(params.get('lang') === 'zh' ? 'zh' : 'en')
  const [notice, setNotice] = useState('All tasks and measurements are sample data.')
  const [epoch, setEpoch] = useState(0)
  announce = setNotice
  document.documentElement.dataset.theme = theme
  document.documentElement.lang = language
  const t = useMemo(() => {
    const dictionary = language === 'zh' ? zh : en
    return (key: keyof typeof en, parameters?: Record<string, unknown>) => {
      let text = dictionary[key] ?? key
      for (const [name, value] of Object.entries(parameters ?? {})) text = text.replaceAll('{' + name + '}', String(value))
      return text
    }
  }, [language])
  return <><div className="preview-bar">
    <strong>Preview data</strong><span className="preview-note" role="status">{notice}</span>
    <label>Theme<select value={theme} onChange={event => setTheme(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="zh">中文</option></select></label>
    <button type="button" onClick={() => { data = structuredClone(initial); clearPreviewSession(); setEpoch(epoch + 1); setNotice('Preview data reset. No live system was changed.') }}>Reset</button>
  </div><div className="preview-app" key={epoch} onClick={event => {
    const anchor = (event.target as Element).closest('a')
    if (anchor?.href && !anchor.href.startsWith(location.origin)) { event.preventDefault(); setNotice(previewMessage) }
  }}><App t={t} deploymentForm={undefined} openSession={async () => setNotice(previewMessage)} /></div></>
}
createRoot(document.getElementById('root')!).render(<Preview />)
