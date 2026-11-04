import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [file, width, out, theme] = process.argv.slice(2)
const port = 9300 + Math.floor(Math.random()*500)
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${port}`,`--window-size=${width},1000`,'about:blank'],{stdio:'ignore'})
const sleep = ms => new Promise(r=>setTimeout(r,ms))
let list; for (let i=0;i<50;i++){ try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find(t=>t.type==='page')) break } catch {} await sleep(200) }
const ws = new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>ws.onopen=r)
let id=0; const pend=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id)}}
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))})
const ev=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true})).result.value
await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride',{width:+width,height:1000,deviceScaleFactor:1,mobile:false})
await send('Page.navigate',{url:'file://'+file}); await sleep(800)
const log=[]
const state=()=>ev(`(()=>{const a=document.activeElement;const s=a.closest('.dt-metrics-scroll');return JSON.stringify({tag:a.tagName,id:a.id,cls:a.className,aria:a.getAttribute&&a.getAttribute('aria-label'),sl:s?s.scrollLeft:null,sw:s?s.scrollWidth:null,cw:s?s.clientWidth:null,docW:document.documentElement.scrollWidth,winW:innerWidth})})()`)
const key=async(k,code,vk,mod=0)=>{await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,windowsVirtualKeyCode:vk,modifiers:mod});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk,modifiers:mod})}
log.push('start '+await state())
for (let i=0;i<2;i++){ await key('Tab','Tab',9); log.push('tab'+(i+1)+' '+await state()) }
// focus is now on 1st scroll region (or later); press ArrowRight x20 to scroll
for (let i=0;i<20;i++) await key('ArrowRight','ArrowRight',39)
await sleep(500)
log.push('after ArrowRight '+await state())
const shot=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(out,Buffer.from(shot.data,'base64'))
const full=await ev(`document.documentElement.scrollHeight`)
await send('Emulation.setDeviceMetricsOverride',{width:+width,height:Math.min(full,6000),deviceScaleFactor:1,mobile:false}); await sleep(300)
const s2=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(out.replace('.png','-full.png'),Buffer.from(s2.data,'base64'))
console.log(log.join('\n')); ws.close(); chrome.kill()
