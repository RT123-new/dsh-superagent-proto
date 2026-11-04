import { connect } from './cdp.mjs'
const c = await connect()
const base = 'http://127.0.0.1:8931/index.html'
c.events.length = 0
await c.viewport(1280, 900)
await c.navigate(`${base}?seed=450`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 200`, 20000)
await c.evaluate(`document.querySelector('.dt-blocked-effects').scrollIntoView()`)
await new Promise(r => setTimeout(r, 400))
await c.shot('/downloads/sec8-01-first-page-200-of-450.png')
const count = await c.evaluate(`document.querySelector('.dt-blocked-effects h3')?.textContent`)
console.log('header:', count)
// keyboard: tab to the Load more button, capture the focus ring
let focused = ''
for (let i = 0; i < 650; i++) {
  await c.tab()
  focused = await c.evaluate(`document.activeElement?.textContent ?? ''`)
  if (focused.includes('加载更多')) break
}
console.log('focused after tabs:', JSON.stringify(focused))
if (!focused.includes('加载更多')) throw new Error('Load more not reachable by keyboard')
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-02-keyboard-focus-loadmore.png')
await c.enter()
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 400`, 15000)
await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li')[398].scrollIntoView({block:'center'})`)
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-03-appended-400.png')
// click precisely on the remaining Load more
await c.click('.dt-blocked-effects > button')
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 450`, 15000)
const gone = await c.evaluate(`![...document.querySelectorAll('button')].some(b => b.textContent.includes('加载更多'))`)
console.log('load more exhausted:', gone)
await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li')[448].scrollIntoView({block:'center'})`)
await c.shot('/downloads/sec8-04-exhausted-450.png')
// rearm flow on an attempt-unknown row
await c.evaluate(`document.querySelector('.dt-blocked-effects').scrollIntoView()`)
await new Promise(r => setTimeout(r, 300))
await c.evaluate(`[...document.querySelectorAll('.dt-blocked-effects li')].find(li => li.textContent.includes('r0')).scrollIntoView({block:'center'})`)
await c.click('.dt-blocked-effects li button')
await c.waitFor(`document.body.textContent.includes('确定') || document.querySelector('[role="alertdialog"], .dt-confirm, .dt-popover')`, 5000)
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-05-rearm-confirm.png')
const before = await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li').length`)
const ok = await c.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s/g, '') === '确定'); if (!b) return false; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
console.log('confirm button at:', JSON.stringify(ok))
if (!ok) throw new Error('no 确定 button')
await c.clickAt(ok.x, ok.y)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length < ${before}`, 15000)
await c.shot('/downloads/sec8-06-rearmed.png')
console.log('rearm removed row:', before, '->', await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li').length`))
const errors = c.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
console.log('page errors:', errors.length, JSON.stringify(errors.slice(0, 3)).slice(0, 600))
c.close()
