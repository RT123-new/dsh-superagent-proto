import { describe,it,expect } from 'vitest'
import { expression } from './expression.ts'
// @ts-ignore Optional standalone module.
import { workerPromptV2, WORKER_SCHEMA } from './prompts.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
describe('prospective v2 prompt qualification, no provider calls',()=>{
 it('declares string leaves, exact binary operations and no additional keys',()=>{
  expect(WORKER_SCHEMA.$defs.expression.oneOf[0]).toEqual({type:'string',enum:['n','low','high']})
  const node=WORKER_SCHEMA.$defs.expression.oneOf[1]
  expect(node.additionalProperties).toBe(false);expect(node.properties.args.minItems).toBe(2);expect(node.properties.args.maxItems).toBe(2)
  const prompt=JSON.parse(workerPromptV2('synthetic broken code',11))
  expect(()=>expression(prompt.syntax_example.expression)).not.toThrow()
  expect(prompt.example_note).toContain('not the complete solution')
 })
 it('has no variant field and is byte-identical for a paired task seed',()=>{
  const baseline=workerPromptV2('synthetic broken code',29),repaired=workerPromptV2('synthetic broken code',29)
  expect(baseline).toBe(repaired)
  expect(Buffer.byteLength(baseline)).toBeLessThanOrEqual(16384)
  expect(baseline).not.toContain('baseline');expect(baseline).not.toContain('repaired')
 })
 it('keeps the v1 failed-output rejection and acceptance implementation unchanged',()=>{
  const source=readFileSync(new URL('./expression.ts',import.meta.url),'utf8')
  expect(createHash('sha256').update(source).digest('hex')).toBe('3ee6a923da920dcfe80dc51e0ac421c1027587acc35df3c30fbcf71343b77f3a')
  const actual={op:'max',args:[{op:'min',args:[{n:'n'},{n:'high'}]},{n:'low'}]}
  expect(()=>expression(actual)).toThrow('Invalid expression')
 })
})
