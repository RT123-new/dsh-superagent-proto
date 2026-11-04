// Real-browser keyboard/touch flow for the blocked-effects rearm control, over the CDP. Usage: node flow.mjs <lang> <width> <touch 0|1> <outPrefix>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [lang, width, touch, out] = process.argv.slice(2)
const url = `file://${process.cwd()}/bh/index.html?lang=${lang}${process.env.THEME ? "&theme=" + process.env.THEME : ""}`
const port = 9800 + Math.floor(Math.random() * 150)
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find(t => t.type === 'page')) break } catch {} await sleep(200) }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r)
let id = 0; const pend = new Map(); const errors = []
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)) }
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 900, deviceScaleFactor: 1, mobile: touch === '1' })
if (touch === '1') await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Page.navigate', { url }); await sleep(2000)
const log = []; const L = (k, v) => { log.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`) }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}${process.env.THEME ? "-" + process.env.THEME : ""}-${name}.png`, Buffer.from(r.data, 'base64')) }
const key = async (k, code, vk, mod = 0, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod, ...(text ? { text } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod }) }
const Tab = (shift = false) => key('Tab', 'Tab', 9, shift ? 8 : 0)
const Enter = () => key('Enter', 'Enter', 13, 0, '\r')
const Esc = () => key('Escape', 'Escape', 27)
const active = () => ev(`(()=>{const a=document.activeElement;const d=a.closest('[role=dialog]');return JSON.stringify({tag:a.tagName,text:(a.textContent||'').trim().slice(0,30),aria:a.getAttribute('aria-label'),inDialog:!!d||a.getAttribute('role')==='dialog',role:a.getAttribute('role')})})()`)
const dialog = () => ev(`(()=>{const d=document.querySelector('[role=dialog]');return d?JSON.stringify({label:d.getAttribute('aria-label'),text:d.innerText.replace(/\\n+/g,' | '),w:Math.round(d.getBoundingClientRect().width),vw:innerWidth}):null})()`)
const reqs = () => ev(`JSON.stringify((window.__requests||[]).filter(r=>r.method==='POST'))`)
const geom = () => ev(`JSON.stringify({docW:document.documentElement.scrollWidth,winW:innerWidth})`)
const rearmLabel = lang === 'en' ? 'Rearm' : '重新启动'
L('blocked section', await ev(`document.querySelector('.dt-blocked-effects')?.innerText.replace(/\\n+/g,' | ')`))
L('geometry', await geom())
await shot('1-list')
// Keyboard: Tab until the first Rearm button has focus.
let n = 0; for (; n < 60; n++) { await Tab(); const a = JSON.parse(await active()); if (a.tag === 'BUTTON' && a.text === rearmLabel) break }
L('tabs to first Rearm', n + 1); L('focused', await active())
await Enter(); await sleep(300)
L('dialog after Enter', await dialog()); L('focus after open', await active()); await shot('2-dialog-unknown')
const seen = []; for (let i = 0; i < 6; i++) { await Tab(); seen.push((JSON.parse(await active())).inDialog) }
L('focus stays in dialog over 6 Tabs', seen.every(Boolean)); await Tab(true); L('shift+tab stays', (JSON.parse(await active())).inDialog)
await Esc(); await sleep(300)
L('dialog after Escape', await dialog()); L('focus returns to', await active())
// Cancel path
await Enter(); await sleep(300)
const cancelLabel = lang === 'en' ? 'Cancel' : '取消', confirmLabel = lang === 'en' ? 'Confirm' : '确定'
for (let i = 0; i < 8; i++) { await Tab(); if ((JSON.parse(await active())).text === cancelLabel) break }
L('focused cancel', await active()); await Enter(); await sleep(300)
L('dialog after Cancel', await dialog()); L('POSTs after Cancel', await reqs())
// Second (known-outcome, long key) entry: no unknown warning, long key stays inside viewport.
const rearms = await ev(`[...document.querySelectorAll('.dt-blocked-effects button')].map(b=>b.textContent.trim()).filter(t=>t===${JSON.stringify(rearmLabel)}).length`)
L('rearm buttons', rearms)
await ev(`[...document.querySelectorAll('.dt-blocked-effects button')][1].focus()`); await Enter(); await sleep(300)
L('dialog for known outcome', await dialog()); await shot('3-dialog-known'); await Esc(); await sleep(200)
// Confirm path on the first entry
await ev(`[...document.querySelectorAll('.dt-blocked-effects button')][0].focus()`); await Enter(); await sleep(300)
for (let i = 0; i < 8; i++) { await Tab(); if ((JSON.parse(await active())).text === confirmLabel) break }
L('focused confirm', await active()); await Enter(); await sleep(800)
L('dialog after Confirm', await dialog()); L('POSTs after Confirm', await reqs()); L('geometry end', await geom()); await shot('4-after-confirm')
L('page errors', errors)
if (touch === '1') {
  const pt = JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('.dt-blocked-effects button')][0];const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height})})()`))
  L('touch target size px', { w: Math.round(pt.w), h: Math.round(pt.h) })
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400)
  L('dialog after tap', await dialog()); await shot('5-touch-dialog')
}
console.log(log.join('\n')); ws.close(); chrome.kill()
