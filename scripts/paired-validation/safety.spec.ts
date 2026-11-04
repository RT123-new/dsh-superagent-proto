import { describe,it,expect } from 'vitest'
import { expression,evaluate } from './expression.ts'
describe('synthetic arithmetic safety',()=>{
 it('rejects model object leaves rather than interpreting executable code',()=>{
  expect(()=>expression({op:'max',args:[{op:'min',args:[{n:'n'},{n:'high'}]},{n:'low'}]})).toThrow('Invalid expression')
 })
 it('accepts exactly the declared grammar and checks clamp boundaries',()=>{
  const ast=expression({op:'min',args:['high',{op:'max',args:['n','low']}]})
  expect(evaluate(ast,{n:-4,low:0,high:8})).toBe(0)
  expect(evaluate(ast,{n:3,low:0,high:8})).toBe(3)
  expect(evaluate(ast,{n:12,low:0,high:8})).toBe(8)
 })
 it('refuses extra keys, unapproved operations and deep structures',()=>{
  expect(()=>expression({op:'max',args:['n','low'],code:'anything'})).toThrow()
  expect(()=>expression({op:'eval',args:['n','low']})).toThrow()
  let deep:unknown='n';for(let i=0;i<8;i++)deep={op:'min',args:['high',deep]};expect(()=>expression(deep)).toThrow()
 })
})
