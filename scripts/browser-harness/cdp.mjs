/** Tiny CDP client over node's built-in WebSocket: navigate, wait, real input, screenshots. */
export async function connect(port = 9222) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else if (m.method) events.push(m) }
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: mid, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const waitFor = async (expression, timeoutMs = 15000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)) }
    throw new Error('waitFor timed out: ' + expression)
  }
  const navigate = async url => { await send('Page.navigate', { url }) }
  const shot = async path => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); const { writeFileSync } = await import('node:fs'); writeFileSync(path, Buffer.from(data, 'base64')); console.log('shot', path) }
  const viewport = async (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  const rect = async selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); el.scrollIntoView({ block: 'center' }); const r2 = el.getBoundingClientRect(); return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 } })()`)
  const clickAt = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
  const click = async selector => { const r = await rect(selector); if (!r) throw new Error('no element ' + selector); await clickAt(r.x, r.y) }
  const key = async (keyName, code, keyCode, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(text ? { text } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }) }
  const tab = async () => key('Tab', 'Tab', 9)
  const enter = async () => key('Enter', 'Enter', 13, '\r')
  const close = () => ws.close()
  return { send, evaluate, waitFor, navigate, shot, viewport, rect, clickAt, click, key, tab, enter, close, events }
}
