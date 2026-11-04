/** Prospective prompt qualification. Task and acceptance grammar are unchanged from v1. */
export const WORKER_SCHEMA = {
  type:'object', additionalProperties:false, required:['expression'], properties:{expression:{$ref:'#/$defs/expression'}},
  $defs:{expression:{oneOf:[{type:'string',enum:['n','low','high']},{type:'object',additionalProperties:false,required:['op','args'],properties:{op:{type:'string',enum:['min','max']},args:{type:'array',minItems:2,maxItems:2,items:{$ref:'#/$defs/expression'}}}}]}}
}
export function workerPromptV2(brokenCode,seed){return JSON.stringify({
  task:'Repair clamp by returning one JSON object only. Requirements: clamp below low to low, above high to high, preserve interior. Return no prose or code fences.',
  output_schema:WORKER_SCHEMA,
  grammar_notes:'A variable leaf is a JSON string: "n", "low", or "high". Never wrap leaves in objects. Each internal node has exactly op and args, op is min or max, args has exactly two expressions. Depth at most 5. Do not add other keys.',
  syntax_example:{expression:{op:'min',args:['n','high']}},
  example_note:'This example shows grammar only. It clips the upper bound but is not the complete solution. Derive the solution for both bounds.',
  brokenCode,seed
})}
