import { connect } from './cdp.mjs'
const c = await connect()
const base = 'http://127.0.0.1:8931/index.html'
await c.viewport(1280, 900)
// 1. targeted endpoint-only failure with nothing loaded yet: the rest of the view stays healthy
await c.navigate(`${base}?seed=0&downpaths=effects/blocked&lang=en`)
await c.waitFor(`document.body.textContent.includes('Endpoint effects/blocked unavailable')`, 20000)
await c.waitFor(`document.body.textContent.includes('Fix regression') || !!document.querySelector('.dt-list')`, 20000)
console.log('case1 alert:', await c.evaluate(`document.querySelector('[role=alert]')?.textContent`))
await c.shot('/downloads/sec8-en-06-blocked-endpoint-down.png')
// 2. refresh failure with rows already shown: rows stay, stale notice appears
await c.navigate(`${base}?seed=3&lang=en`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 3`, 20000)
await c.evaluate(`window.__server.downPaths = ['effects/blocked']`)
await c.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`)
await c.waitFor(`document.body.textContent.includes('showing the earlier state')`, 20000)
console.log('case2 rows:', await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li').length`),
  'notice:', await c.evaluate(`document.querySelector('.dt-blocked-effects .dt-hint, .dt-blocked-effects p')?.textContent`))
await c.evaluate(`document.querySelector('.dt-blocked-effects').scrollIntoView()`)
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-en-07-blocked-stale-notice.png')
// 3. Load more page fails: first page stays, error in place, Load more remains as the retry
await c.navigate(`${base}?seed=450&lang=en`)
await c.waitFor(`document.querySelectorAll('.dt-blocked-effects li').length === 200`, 20000)
await c.evaluate(`window.__server.downPaths = ['effects/blocked']`)
await c.click('.dt-blocked-effects > button')
await c.waitFor(`document.body.textContent.includes('Endpoint effects/blocked unavailable')`, 20000)
console.log('case3 rows:', await c.evaluate(`document.querySelectorAll('.dt-blocked-effects li').length`),
  'retry present:', await c.evaluate(`[...document.querySelectorAll('.dt-blocked-effects button')].some(b => b.textContent === 'Load more')`))
await c.evaluate(`document.querySelector('.dt-blocked-effects [role=alert]').scrollIntoView({block:'center'})`)
await new Promise(r => setTimeout(r, 300))
await c.shot('/downloads/sec8-en-08-blocked-loadmore-error.png')
process.exit(0)
