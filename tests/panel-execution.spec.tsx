// @vitest-environment jsdom
// The Execution status, a Ticket, and the Execution settings.
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, all, find, tab, click, type, text, field, at, settle } from './fixtures/panel.tsx'
import { MEMBER, server, ticketSummary, threadSummary } from './fixtures/panel-server.ts'

usePanel()
it('lists Tickets under Execution by who they wait on, with the Executor state and its pause as an action', async () => {
  server.tickets.open = [ticketSummary(), ticketSummary({ id: 't2', title: '执行中的工单', threads: [{ key: 'github:7',
    source: 'github', title: '#7 x', facts: { number: { value: '#7' }, autoMerge: { label: { zh: '自动合并', en: 'Auto-merge' },
      value: { zh: '已开启', en: 'on' } } } }] })]
  await mount()
  await click(zh['tab.execution'])
  expect(document.querySelector('.dt-status-title')?.textContent).toBe(zh.statusTitle)
  expect(server.requests.some(request => request.path === 'tickets?state=open&limit=20')).toBe(true)
  expect(text()).toContain(zh.executorRunning)
  expect(all('.dt-chip').map(chip => chip.textContent)).toContain('GitHub#7自动合并已开启')
  await click(zh.idleLabel)
  expect(server.requests.some(request => request.path === 'tickets?state=idle&limit=20')).toBe(true)
  expect(text()).toContain('执行器结束了当前回合')
  await click(zh['ticket.ended'])
  expect(text()).toContain('旧工单')
  expect(text()).toContain(zh['outcome.stopped'])
  expect(all('.dt-status-line .dt-lv').map(item => item.textContent)).toEqual(['执行中 2 / 3', '排队 0'])
  // The pause is its own action: an Execution settings draft started before it still saves.
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['promptPart.runtime/work'])
  await type(field<HTMLInputElement>(zh.maxWorkers), '4')
  await click(tab(zh['tab.execution']))
  await click(zh.pauseProcessing)
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'executor/pause')).toMatchObject({ method: 'POST', body: { paused: true } })
  expect(text()).toContain(zh.processingPaused)
  expect(find(zh.resumeProcessing).textContent).toBe(zh.resumeProcessing)
  await click(tab(zh['tab.settings']))
  await click(zh.save)
  expect(server.settings).toMatchObject({ paused: true, executor: { maxWorkers: 4 } })
})

it('stops an open Ticket from its page after confirmation', async () => {
  await mount()
  await click('修复回归')
  await click(zh.stop)
  expect(server.requests.some(request => request.path.endsWith('/stop'))).toBe(false)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('停止“修复回归”')
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'tickets/t1/stop' && request.method === 'POST')).toBe(true)
})

it('shows a Ticket with its stage, its Mandate details with the Trigger and Decision behind it, its Threads, and the rest behind disclosures', async () => {
  await mount()
  await click(all('.dt-open').find(button => button.textContent === '修复回归')!)
  expect(document.querySelector('.dt-page-title h2')?.textContent).toBe('修复回归')
  // Progress is in the Channels and the Session, so the page has no report section.
  expect(all('.dt-section-title').map(title => title.querySelector('.dt-section-name')?.textContent)).toEqual(['授权详情', '未送达的输入', '订阅的线程'])
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh.executingLabel)
  expect(document.querySelector('.dt-status-line .dt-stage .dt-spinner')).not.toBeNull()
  // A Thread this Ticket follows reads as subscribed on its page, though no other Ticket follows it.
  expect(all('.dt-list .dt-ticket .dt-stage').map(stage => stage.textContent)).toContain(zh.threadSubscribed)
  expect(all('.dt-list .dt-ticket .dt-stage').map(stage => stage.textContent)).not.toContain(zh.threadUnsubscribed)
  expect(all('.dt-status-line .dt-lv').map(item => item.textContent)).toEqual(['授权 明确', '发起 飞书 · Alice', expect.stringMatching(/^更新 /)])
  for (const expected of ['修复登录页回归', '点名方式@ 智能体', '名单里的人明确请求，由主 Session 接单', '未送达：等待派工运行',
    'Alice：顺便改标题']) expect(text()).toContain(expected)
  expect(all('.dt-chip').map(chip => chip.textContent)).toContain('飞书团队群')
  await click(zh['term.channel'])
  expect(all('.dt-disclosure-body a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['飞书消息',
    'https://applink.feishu.cn/client/chat/open?openChatId=oc_1'], ['GitHub #42', 'https://github.com/acme/widgets/issues/42']])
  await click(zh['term.environment'])
  expect(all('.dt-disclosure-body .dt-table tr').map(row => row.textContent)).toEqual(['DSH_SUPERAGENT_DIR/w/t1',
    'DSH_SUPERAGENT_GITHUB_NUMBER—'])
  await click(document.querySelector<HTMLElement>('.dt-trigger-link')!)
  expect(tab(zh['tab.trigger']).getAttribute('aria-selected')).toBe('true')
})

it('reports a missing Ticket instead of rendering an empty page', async () => {
  at({ page: 'execution', id: 'missing' })
  await mount()
  expect(document.querySelector('.dt-hint')?.textContent).toBe(zh.ticketNotFound)
})

it('links a question to its Channel, folds consecutive automated messages among Inputs, and shows field explanations in a hover tooltip',
  async () => {
  const ci = (id: string, at: string, failed: number) => ({ id, kind: 'trigger' as const, triggerId: `c${id}`, at, delivered: true,
    trigger: { id: `c${id}`, actor: { source: 'github', id: '' }, human: false,
      preview: `CI of PR #42 at abc1234: 10 checks, ${failed} failed, 0 running.`, thread: 'github:42' } })
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'answer', attention: { id: 'q1', question: '需要确认按钮颜色' }, inputs: [ci('i3',
    '2026-09-22T00:06:00Z', 1), ci('i2', '2026-09-22T00:05:00Z', 0)] }
  await mount()
  await click(all('.dt-open').find(button => button.textContent === '修复回归')!)
  expect(all('.dt-banner a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['去飞书回答',
    'https://applink.feishu.cn/client/chat/open?openChatId=oc_1']])
  await click('已送达的输入 · 2')
  expect(all('.dt-disclosure-body .dt-row-title').map(title => title.textContent)).toEqual(['自动通知：CI of PR #42 at abc1234: 10 checks, 1 failed, 0 running.'])
  await click('同一发送者之前还有 1 条自动消息')
  expect(text()).toContain('CI of PR #42 at abc1234: 10 checks, 0 failed, 0 running.')
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(text()).not.toContain('到期后记为未完成')
  const tip = field(zh.evalTimeout).closest('.dt-field')!.querySelector<HTMLElement>('.dt-info')!
  await act(async () => { tip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('到期后记为未完成')
  expect(tip.closest('.dt-field')!.textContent).not.toContain('到期后记为未完成')
  await act(async () => { tip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

it('offers a Ticket awaiting review its review place and Session in the page head', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'review', threads: [threadSummary(),
    { ...threadSummary({ key: 'github:42', source: 'github', title: '#42 Fix login' }), url: 'https://github.com/acme/widgets/pull/42' }] }
  at({ page: 'execution', id: 't1' })
  await mount()
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['stage.review'])
  expect(all('.dt-page-head a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['打开 GitHub 原文',
    'https://github.com/acme/widgets/pull/42']])
})

it('keeps what a person types in the Execution settings, converting it once on save', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  const blocked = () => field<HTMLInputElement>(zh.blockedCommands), root = () => field<HTMLInputElement>(zh.executionDirectory),
    workers = () => field<HTMLInputElement>(zh.maxWorkers)
  // A separator typed before the next command, a space inside a path and a cleared number stay as typed.
  await type(blocked(), 'gh-personal ')
  expect(blocked().value).toBe('gh-personal ')
  await type(blocked(), 'gh-personal, gh-other')
  await type(root(), '/srv/my work ')
  expect(root().value).toBe('/srv/my work ')
  await type(workers(), '')
  expect(workers().value).toBe('')
  await type(workers(), '2')
  await click(zh.save)
  expect(server.requests.find(request => request.path === 'settings/executor')?.body).toMatchObject({ value: { blockedCommands: ['gh-personal', 'gh-other'], directory: '/srv/my work ', maxWorkers: 2 } })
  expect(server.settings.executor).toMatchObject({ blockedCommands: ['gh-personal', 'gh-other'], directory: '/srv/my work', maxWorkers: 2 })
})

it('says why an Input was not delivered on its Ticket\'s page, in either language', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'delivery', deliveryError: 'feishu: message recalled' }
  at({ page: 'execution', id: 't1' })
  await mount()
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['stage.delivery'])
  expect(document.querySelector('.dt-banner.dt-danger')?.textContent).toBe(`${zh.deliveryFailedPrefix}feishu: message recalled`)
  expect(text()).toContain(zh.inputRetryHint)
  expect(text()).not.toContain(zh.inputWaitingHint)
  expect(document.querySelector('.dt-status-line')?.textContent).toMatch(/9月\d+日/)
  await remount(en)
  expect(document.querySelector('.dt-status-line')?.textContent).toMatch(/Sep \d+/)
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(en['stage.delivery'])
  expect(document.querySelector('.dt-banner.dt-danger')?.textContent).toBe(`${en.deliveryFailedPrefix}feishu: message recalled`)
  expect(text()).toContain(en.inputRetryHint)
})

it('tells a Ticket or Thread that does not exist from a dsh-superagent that is not answering', async () => {
  at({ page: 'execution', id: 't9' })
  await mount()
  expect(text()).toContain(zh.ticketNotFound)
  // While dsh-superagent restarts, DSH's web server answers every route with an empty 404.
  at({ page: 'execution', id: 't1' })
  server.down = true
  await remount()
  expect(text()).not.toContain(zh.ticketNotFound)
  expect(text()).toContain(zh.hostNotRunning)
  at({ page: 'trigger', id: 'feishu:oc_1:om_root' })
  await remount()
  expect(text()).not.toContain(zh.threadNotFound)
  expect(text()).toContain(zh.hostNotRunning)
})

it('gives a Ticket a bot\'s message started its basis, marks a Thread it follows for context, and an Input it handed back', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, mandate: { ...t1.mandate, strength: 'inferred', basis: { via: 'bot', sender: '评审机器人',
    observation: { mode: 'auto' } } },
  basis: { facts: [{ name: 'sender', value: '评审机器人' }, { name: 'bot' }, { name: 'mode', value: 'auto' }], legacy: false },
  threads: [threadSummary(), { ...threadSummary({ key: 'github:7', title: '#7 相关 Issue' }), context: true }],
  inputs: [{ id: 'i1', kind: 'trigger', triggerId: 'e2', at: '2026-09-22T00:03:00Z', delivered: true, trigger: { id: 'e2',
    actor: { source: 'feishu', id: MEMBER, name: { zh: 'Alice', en: 'Alice' } }, human: true, preview: '顺便加一个页面',
    thread: 'feishu:oc_1:om_root', handback: { reason: 'Asks for a new page', at: '2026-09-22T00:05:00Z' } } }] }
  at({ page: 'execution', id: 't1' })
  await mount()
  const facts = () => all('.dt-kv > div').map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])
  expect(facts()).toEqual(expect.arrayContaining([[zh['basis.sender'], '评审机器人'], [zh['basis.bot'], zh.yes], [zh['basis.mode'], zh['mode.auto']]]))
  expect(all('.dt-list .dt-ticket').map(row => row.querySelector('.dt-tag')?.textContent)).toEqual([undefined, zh.contextOnly])
  await click(zh.deliveredInputs.replace('{count}', '1'))
  expect(text()).toContain('已交回评估：Asks for a new page')
  await remount(en)
  expect(facts()).toEqual(expect.arrayContaining([[en['basis.bot'], en.yes]]))
  expect(all('.dt-list .dt-ticket').map(row => row.querySelector('.dt-tag')?.textContent)).toEqual([undefined, en.contextOnly])
  await click(en.deliveredInputs.replace('{count}', '1'))
  expect(text()).toContain('Handed back for an Eval: Asks for a new page')
})

it('words an ended Ticket by its outcome, on its row and its page, with a person\'s reason after it', async () => {
  const fields = { id: 't3', title: '已合并的工单', state: 'ended' as const, actions: { retry: false, stop: false },
    ended: { at: '2026-09-21T00:00:00Z', by: 'executor' as const, outcome: 'merged' as const } }
  server.tickets.ended = [ticketSummary(fields, { stage: 'ended' }), ...server.tickets.ended]
  server.ticketDetails.t3 = { ...server.ticketDetails.t1!, ...fields, stage: 'ended' }
  await mount()
  await click(zh['tab.execution'])
  await click(zh['ticket.ended'])
  expect(all('.dt-ticket-stage').map(stage => stage.textContent)).toEqual([zh['outcome.merged'], zh['outcome.stopped']])
  await click('已合并的工单')
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['outcome.merged'])
  expect(text()).toContain(zh['outcome.merged'])
  expect(text()).not.toContain('执行器结束')
  server.ticketDetails.t3 = { ...server.ticketDetails.t3, ended: { at: '2026-09-21T00:00:00Z', by: 'human', outcome: 'stopped',
    reason: '不需要了' } }
  await remount(en)
  expect(all('.dt-hint').map(hint => hint.textContent).find(line => line?.includes(en['outcome.stopped']))).toMatch(/Stopped by a person: 不需要了$/)
})

it('paginates a long blocked-effects history instead of loading it unbounded', async () => {
  server.blockedEffects = Array.from({ length: 450 }, (_, i) => ({ kind: 'relay', key: `r${i}`, class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }))
  await mount()
  await click(zh['tab.execution'])
  expect(all('.dt-blocked-effects li')).toHaveLength(200)                                  // first bounded page only
  expect(server.requests.filter(request => request.path.startsWith('effects/blocked'))).toHaveLength(1)
  expect(text()).toContain('relay · r199')
  expect(text()).not.toContain('relay · r200')
  expect(server.blockedEffects.length).toBe(450)
  await click(zh.loadMore)
  expect(all('.dt-blocked-effects li')).toHaveLength(400)                                  // appended, first page kept
  expect(text()).toContain('relay · r399')
  await click(zh.loadMore)
  expect(all('.dt-blocked-effects li')).toHaveLength(450)
  expect(text()).toContain('relay · r449')
  expect(all('button').some(button => button.textContent?.includes(zh.loadMore))).toBe(false)  // exhausted: no more pages
})

it('a rearm after appending pages does not duplicate the shifted boundary row', async () => {
  server.blockedEffects = Array.from({ length: 250 }, (_, i) => ({ kind: 'relay', key: `r${i}`, class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }))
  await mount()
  await click(zh['tab.execution'])
  await click(zh.loadMore)                                                                 // 250 rows across two pages
  expect(all('.dt-blocked-effects li')).toHaveLength(250)
  const first = all('.dt-blocked-effects li')[0]!
  await click(first.querySelector('button')!)                                              // rearm the first row
  await click(zh.confirm)
  const keys = all('.dt-blocked-effects li').map(row => row.textContent)
  expect(keys).toHaveLength(249)
  expect(new Set(keys).size).toBe(249)                                                     // no duplicated boundary row
})

it('tells the operator when the server refuses a rearm instead of silently keeping the row', async () => {
  server.blockedEffects = [{ kind: 'relay', key: 'r1', class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }]
  await mount()
  await click(zh['tab.execution'])
  await click(zh.rearmEffect)
  server.blockedEffects = []                                                               // a concurrent rearm wins before the confirmation
  await click(zh.confirm)
  expect(text()).toContain(zh.rearmEffectRefused)
})

it('shows a blocked-endpoint failure instead of silently hiding blocked work', async () => {
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('effects/blocked')
    ? new Response(JSON.stringify({ error: 'Blocked recovery endpoint unavailable' }), { status: 503 }) : realFetch(url, init)))
  await mount()
  await click(zh['tab.execution'])
  expect(server.requests.some(request => request.path.startsWith('tickets?'))).toBe(true)   // the rest of the view is healthy
  expect(text()).toContain('Blocked recovery endpoint unavailable')
})

it('keeps the earlier blocked rows with a stale notice when a refresh fails', async () => {
  server.blockedEffects = [{ kind: 'relay', key: 'r1', class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }]
  await mount()
  await click(zh['tab.execution'])
  expect(text()).toContain('relay · r1')
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('effects/blocked?')
    ? new Response(JSON.stringify({ error: 'Blocked recovery endpoint unavailable' }), { status: 503 }) : realFetch(url, init)))
  await click(zh.rearmEffect)
  await click(zh.confirm)                                                                  // the rearm succeeds; the reload behind it fails
  expect(text()).toContain('relay · r1')                                                   // prior rows stay
  expect(text()).toContain(zh.blockedEffectsStale.split('{error}')[0])
  expect(text()).toContain('Blocked recovery endpoint unavailable')
})

it('reports a rejected blocked-history page without an unhandled rejection and Load More stays as the retry', async () => {
  server.blockedEffects = Array.from({ length: 250 }, (_, index) => ({ kind: 'relay', key: `r${index}`, class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }))
  const realFetch = globalThis.fetch
  let failPages = true
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('effects/blocked') && String(url).includes('cursor=') && failPages
    ? new Response(JSON.stringify({ error: 'Blocked history unavailable' }), { status: 503 }) : realFetch(url, init)))
  const rejections: unknown[] = []
  const onRejection = (event: PromiseRejectionEvent) => rejections.push(event.reason)
  window.addEventListener('unhandledrejection', onRejection)
  await mount()
  await click(zh['tab.execution'])
  await click(zh.loadMore)
  expect(text()).toContain('Blocked history unavailable')
  expect(text()).toContain('relay · r0')                                                   // the first page stays
  expect(rejections).toEqual([])                                                          // no unhandled rejection
  failPages = false
  await click(zh.loadMore)                                                                // retry after the failure
  expect(text()).toContain('relay · r249')
  expect(text()).not.toContain('Blocked history unavailable')
  window.removeEventListener('unhandledrejection', onRejection)
})

it('keeps the generation the operator chose when a background refresh changes the row while confirmation is open', async () => {
  server.blockedEffects = [{ kind: 'relay', key: 'r1', class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 7 }]
  await mount()
  await click(zh['tab.execution'])
  await click(zh.rearmEffect)
  server.blockedEffects = [{ ...server.blockedEffects[0]!, generation: 8 }]
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await settle()
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'effects/relay/rearm')?.body).toMatchObject({ expectedGeneration: 7 })
})

it('keeps a still-blocked older page row visible with a fresh generation after the server refuses the rearm', async () => {
  server.blockedEffects = Array.from({ length: 250 }, (_, index) => ({ kind: 'relay', key: `r${index}`, class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: false, generation: 1 }))
  const realFetch = globalThis.fetch
  let refusals = 1
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('effects/relay/rearm') && refusals-- > 0) {
      server.blockedEffects.find(effect => effect.key === 'r249')!.generation = 2          // the server moved on while refusing
      return new Response(JSON.stringify({ rearmed: false }), { status: 200 })
    }
    return realFetch(url, init)
  }))
  await mount()
  await click(zh['tab.execution'])
  await click(zh.loadMore)
  await click(all('.dt-blocked-effects li')[249]!.querySelector('button')!)
  await click(zh.confirm)
  expect(text()).toContain(zh.rearmEffectRefused)
  expect(server.blockedEffects.some(effect => effect.key === 'r249')).toBe(true)
  expect(all('.dt-blocked-effects li').some(row => row.textContent!.includes('relay · r249 ·'))).toBe(true)
  await click(all('.dt-blocked-effects li')[249]!.querySelector('button')!)
  await click(zh.confirm)
  const retry = server.requests.filter(request => request.path === 'effects/relay/rearm').at(-1)
  expect(retry?.body).toMatchObject({ expectedGeneration: 2 })                            // retried with the refreshed generation
})

it('sends one stop for a double click on Confirm', async () => {
  at({ page: 'execution', id: 't1' })
  await mount()
  await click(zh.stop)
  const confirm = find(zh.confirm)
  await act(async () => { confirm.click(); confirm.click() })
  expect(server.requests.filter(request => request.path === 'tickets/t1/stop')).toHaveLength(1)
})

it('final review 2.4: Execution lists blocked background tasks by safe class and rearms one only on an explicit confirmed click', async () => {
  server.blockedEffects = [{ kind: 'relay', key: 'r1', class: 'permanent', attempts: 1, since: '2026-09-22T00:00:00Z', attemptUnknown: true, generation: 7 }]
  await mount()
  await click(zh['tab.execution'])
  expect(text()).toContain(zh.blockedEffectsTitle)
  expect(text()).toContain('relay · r1 · permanent')
  expect(text()).toContain(zh.blockedEffectUnknown)
  expect(server.requests.some(request => request.path === 'effects/relay/rearm')).toBe(false)
  await click(zh.rearmEffect)
  expect(text()).toContain(zh.blockedEffectUnknown)                                            // the duplicate warning is in the confirmation too
  expect(server.requests.some(request => request.path === 'effects/relay/rearm')).toBe(false)   // not before the confirmation
  await click(zh.confirm)
  // The confirmed click sends the acknowledged risk and the generation the operator saw, for the server's conditional update.
  expect(server.requests.find(request => request.path === 'effects/relay/rearm')).toMatchObject({ method: 'POST', body: { key: 'r1', acknowledgeUnknownOutcome: true, expectedGeneration: 7 } })
  expect(text()).not.toContain('relay · r1')
})
