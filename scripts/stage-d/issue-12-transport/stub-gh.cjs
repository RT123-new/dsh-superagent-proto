#!/usr/bin/env node
/** Offline stub of the gh CLI for the Issue 12 transport benchmark. Supports exactly the surface
 * src/infra/commands.ts uses: `api <path> [--include] [--paginate] [--slurp] [-H k: v]`, with canned responses,
 * a fixed simulated server latency (STUB_LATENCY_MS), ETag/304 handling, Link pagination, and HTTP error mapping
 * (`gh: HTTP <status>` on stderr with exit 1, as real gh does). Never touches the network or any credential. */
const { notifications, issue, commentsPages, ETAG } = require('./fixture.cjs')
const latency = Number(process.env.STUB_LATENCY_MS ?? 100)
const args = process.argv.slice(2)
const fail = (status, message) => { process.stderr.write(`gh: ${message} (HTTP ${status})\n`); process.exit(1) }
// gh --paginate makes one HTTP request per page inside a single process: pay the simulated latency per page.
const paginatePages = args.includes('--paginate') ? Math.max(1, commentsPages.length - (Number(/[?&]page=(\d+)/.exec(args[1] ?? '')?.[1] ?? '1') - 1)) : 1
setTimeout(() => {
  try {
    if (args[0] === '--version') { process.stdout.write('gh version 0.0.0-stub\n'); return }
    if (args[0] !== 'api') throw new Error(`unsupported stub command: ${args[0]}`)
    const path = args[1]
    const include = args.includes('--include')
    const paginate = args.includes('--paginate')
    const slurp = args.includes('--slurp')
    const ifNoneMatch = (() => { const index = args.indexOf('-H'); return index >= 0 && /^If-None-Match:/i.test(args[index + 1] ?? '')
      ? args[index + 1].split(':')[1].trim() : undefined })()
    const bare = path.replace(/^repos\/acme\/widgets\/?/, '').split('?')[0]
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? '1')
    if (bare === 'missing') fail(404, 'Not Found')
    let status = 200
    let body
    let link = ''
    if (bare === 'notifications') {
      if (ifNoneMatch === ETAG) fail(304, 'Not Modified')
      body = notifications
    } else if (/^issues\/\d+$/.test(bare)) body = issue(Number(bare.split('/')[1]))
    else if (/^issues\/\d+\/comments$/.test(bare)) {
      body = commentsPages[page - 1] ?? []
      if (page < commentsPages.length) link = `\r\nLink: <https://api.github.com/comments?page=${page + 1}>; rel="next"`
    } else body = []
    if (paginate) {
      const pages = []
      for (let index = page - 1; index < commentsPages.length; index++) pages.push(commentsPages[index])
      process.stdout.write(JSON.stringify(slurp ? pages : pages.flat()))
      return
    }
    if (include) {
      process.stdout.write(`HTTP/2.0 ${status} OK\r\nETag: ${ETAG}\r\nX-Poll-Interval: 60${link}\r\n\r\n${JSON.stringify(body)}`)
      return
    }
    process.stdout.write(JSON.stringify(body))
  } catch (error) { process.stderr.write(`gh: ${String(error)}\n`); process.exit(1) }
}, latency * paginatePages)
