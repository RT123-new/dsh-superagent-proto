// Minimal stand-ins so the panel fixture module loads in a real browser bundle. beforeEach runs eagerly so
// usePanelServer() installs the fetch stub and initial server immediately.
export const beforeEach = (fn) => { fn() }
export const afterEach = () => {}
export const expect = () => { throw new Error('expect is unavailable in the browser harness') }
export const vi = {
  fn: (impl) => impl ?? (() => undefined),
  stubGlobal: (name, value) => { globalThis[name] = value },
  unstubAllGlobals: () => {},
}
