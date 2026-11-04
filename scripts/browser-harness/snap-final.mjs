import { connect } from './cdp.mjs'
const c = await connect()
const base = 'http://127.0.0.1:8931/index.html'
const metrics = async label => console.log(`metrics ${label}:`, JSON.stringify(await c.evaluate(`({ innerWidth, innerHeight, devicePixelRatio, docWidth: document.documentElement.clientWidth })`)))
// 1. EN first page
await c.viewport(1280, 900)
await c.navigate(`${base}?seed=450&lang=en`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 200`, 20000)
await c.evaluate(`document.querySelector('.dt-blocked-effects').scrollIntoView()`)
await new Promise(r => setTimeout(r, 300))
await metrics('desktop-en')
console.log('en header:', await c.evaluate(`document.querySelector('.dt-blocked-effects h3')?.textContent`))
await c.shot('/downloads/sec8-en-01-first-page.png')
// 2. keyboard focus on Load more
let focused = ''
for (let i = 0; i < 650; i++) { await c.tab(); focused = await c.evaluate(`document.activeElement?.textContent ?? ''`); if (focused.includes('Load more')) break }
console.log('focused:', JSON.stringify(focused))
if (!focused.includes('Load more')) throw new Error('keyboard unreachable')
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-en-02-keyboard-focus.png')
// 3. Enter appends
await c.enter()
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 400`, 15000)
await c.evaluate(`document.querySelector('.dt-blocked-effects > button').scrollIntoView({block:'center'})`)
await c.shot('/downloads/sec8-en-03-appended-400.png')
// 4. refusal toast: server state changes before the confirmation
await c.navigate(`${base}?seed=3&lang=en`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 3`, 15000)
await c.click('.dt-blocked-effects li button')
await c.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.replace(/\\s/g,'') === 'Confirm')`, 8000)
await c.evaluate(`window.__server.blockedEffects = []`)
const pos = await c.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s/g,'') === 'Confirm'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await c.clickAt(pos.x, pos.y)
await c.waitFor(`document.body.textContent.includes('refused the rearm')`, 8000)
await new Promise(r => setTimeout(r, 400))
await c.shot('/downloads/sec8-en-04-refusal-toast.png')
console.log('toast:', await c.evaluate(`document.querySelector('.dt-toast')?.textContent`))
// 5. error state EN
await c.navigate(`${base}?seed=3&down=1&lang=en`)
await new Promise(r => setTimeout(r, 2500))
await c.shot('/downloads/sec8-en-05-error-down.png')
console.log('error visible:', await c.evaluate(`(document.body.textContent.match(/not responding|Error|Failed/i) ?? [null])[0]`))
const errors = c.events.filter(e => e.method === 'Runtime.exceptionThrown')
console.log('page exceptions:', errors.length)
c.close()
