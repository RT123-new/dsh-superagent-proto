import { connect } from './cdp.mjs'
const c = await connect()
const base = 'http://127.0.0.1:8931/index.html'
// mobile / touch
await c.viewport(390, 844, true)
await c.navigate(`${base}?seed=450`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 200`, 20000)
await c.evaluate(`document.querySelector('.dt-blocked-effects').scrollIntoView()`)
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-07-mobile-390px-first-page.png')
await c.click('.dt-blocked-effects > button')
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 400`, 15000)
await c.evaluate(`document.querySelector('.dt-blocked-effects > button').scrollIntoView({block:'center'})`)
await c.shot('/downloads/sec8-08-mobile-390px-appended.png')
// loading state: blocked poll delayed 3s
await c.viewport(1280, 900)
await c.navigate(`${base}?seed=450&slow=1`)
await new Promise(r => setTimeout(r, 800))
await c.shot('/downloads/sec8-09-loading-blocked-pending.png')
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 200`, 20000)
// error state: server down
await c.navigate(`${base}?seed=5&down=1`)
await new Promise(r => setTimeout(r, 2500))
await c.shot('/downloads/sec8-10-error-server-down.png')
console.log('error text visible:', await c.evaluate(`(document.body.textContent.match(/错误|失败|Error|Failed|404/i) ?? [null])[0]`))
const errors = c.events.filter(e => e.method === 'Runtime.exceptionThrown')
console.log('page exceptions:', errors.length)
c.close()
