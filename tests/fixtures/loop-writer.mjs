// Child process for the agent-loop SIGKILL proof: a REAL dsh agent loop over the REAL JSONL backend with an offline model that never answers (no network, no paid call).
// It hands one message to the agent exactly as AgentDelivery does (frozen message, agent.steer), then tells the parent via a marker file and waits to be killed.
import { Context } from '@deepseek-ai/cordis'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import { writeFileSync } from 'node:fs'

const [mode, root, marker, messageJson] = process.argv.slice(2)
const ctx = new Context()
for (const name of ['dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-agent-loop']) {
  const m = await import(`@deepseek-ai/${name}`)
  ctx.plugin(m.default ?? m, name.endsWith('jsonl') ? { root, compression: 'none' } : undefined)
}
for (let i = 0; i < 200 && !(ctx.agents && ctx.sessionPersistence); i++) await new Promise(resolve => setTimeout(resolve, 25))
ctx.on('llm/stream', async function* () {
  if (mode === 'model-started') writeFileSync(marker, 'model-started')
  if (mode === 'model-started-flushed') { await ctx.sessionPersistence.flush(); writeFileSync(marker, 'model-started-flushed') }
  await new Promise(() => {})
})
// The loop registers its factory asynchronously after the plugin is mounted.
for (let i = 0; ; i++) {
  try { await ctx.agents.create({ sessionId: 'loop-kill-proof', agentOptions: { provider: 'scripted', model: 'none' } }); break }
  catch (error) { if (i > 200 || !String(error).includes('no agent factory')) throw error; await new Promise(resolve => setTimeout(resolve, 25)) }
}
const agent = ctx.agents.get('loop-kill-proof')
agent.steer(freezeMessage(JSON.parse(messageJson)))
if (mode === 'right-after-steer') writeFileSync(marker, 'right-after-steer')
setInterval(() => {}, 1000)
