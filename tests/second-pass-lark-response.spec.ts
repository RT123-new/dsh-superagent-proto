import { afterEach, expect, it, vi } from 'vitest'
import { Commands } from '../src/infra/commands.ts'
import { classifyError } from '../src/app/retry-policy.ts'
import { sendFeishu } from '../src/sources/feishu-channel.ts'
import { testDeployment } from './fixtures/deployment.ts'

afterEach(() => vi.restoreAllMocks())

it('classifies truncated Feishu output as an unreadable transport response, without preserving response text', async () => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  vi.spyOn(commands, 'run').mockResolvedValue('{"ok":true,"data":{"secret":"private-response-marker')
  const error = await commands.lark(['im', '+messages-reply']).catch((value: unknown) => value)
  expect(classifyError(error)).toBe('transient')
  expect(error).toMatchObject({ unreadable: true })
  expect(String(error)).not.toContain('private-response-marker')
})

it('still exposes a structured provider rejection with its typed code', async () => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  vi.spyOn(commands, 'run').mockResolvedValue('{"ok":false,"error":{"code":231003,"message":"message not found"}}')
  await expect(commands.lark(['im', '+messages-reply'])).rejects.toMatchObject({ code: 231003 })
})

it.each(['null', '"unexpected"', '[]', '{}'])('rejects a syntactically valid but invalid CLI envelope (%s)', async output => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  vi.spyOn(commands, 'run').mockResolvedValue(output)
  const error = await commands.lark(['im', '+messages-reply']).catch((value: unknown) => value)
  expect(classifyError(error)).toBe('transient')
  expect(error).toMatchObject({ unreadable: true })
})

it('refuses a truthy non-boolean ok field instead of marking the send acknowledged', async () => {
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  vi.spyOn(commands, 'run').mockResolvedValue('{"ok":"false","error":{"code":230020,"message":"not acknowledged"}}')
  await expect(sendFeishu({ commands }, { id: 'malformed-envelope', kind: 'reply', text: 'Done',
    channel: { source: 'feishu', thread: 'chat:1', address: { messageId: 'om_1' } } }))
    .rejects.toMatchObject({ unreadable: true })
})
