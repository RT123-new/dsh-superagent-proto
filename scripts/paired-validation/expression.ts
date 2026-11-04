/** Pure bounded evaluator. No code execution, eval, dynamic calls, or filesystem access. */
export type Expression = 'n' | 'low' | 'high' | {op:'min'|'max'; args:[Expression,Expression]}
export function expression(value:unknown,depth=0):Expression {
 if(depth>5)throw Error('Expression too deep')
 if(value==='n'||value==='low'||value==='high')return value
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid expression')
 const x=value as Record<string,unknown>
 if(Object.keys(x).sort().join(',')!=='args,op'||!['min','max'].includes(String(x.op))||!Array.isArray(x.args)||x.args.length!==2)throw Error('Invalid expression')
 return {op:x.op as 'min'|'max',args:[expression(x.args[0],depth+1),expression(x.args[1],depth+1)]}
}
export function evaluate(x:Expression, env:Record<string,number>):number {return typeof x==='string'?env[x]!:Math[x.op](evaluate(x.args[0],env),evaluate(x.args[1],env))}
