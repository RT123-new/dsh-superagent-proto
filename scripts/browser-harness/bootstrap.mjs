// Global shims that must exist before any bundled module evaluates.
globalThis.process ??= { env: {}, argv: ['/node', '/harness'], cwd: () => '/', platform: 'linux', arch: 'x64',
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)), on: () => {}, exit: () => {}, pid: 1, version: 'v22.0.0',
  stdout: { write: () => {} }, stderr: { write: () => {} } }
globalThis.Buffer ??= class { static from() { throw new Error('Buffer unavailable in the browser harness') } }
