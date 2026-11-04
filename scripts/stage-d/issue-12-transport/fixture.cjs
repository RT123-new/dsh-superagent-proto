/** Shared canned GitHub API payloads for the offline transport benchmark (Issue 12). Used by both the stub gh
 * executable and the local HTTP stub server so the gh-subprocess and HTTP-client paths answer identically.
 * No credentials and no network beyond loopback are involved. */
const issue = (number) => ({
  id: 1000 + number, number, title: `Issue ${number}`, body: 'details', state: 'open',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  html_url: `https://github.com/acme/widgets/issues/${number}`, user: { login: 'carol', type: 'User' } })
const comment = (id, number) => ({
  id, body: '@agent-bot take this', user: { login: 'alice', type: 'User' },
  html_url: `https://github.com/acme/widgets/issues/${number}#issuecomment-${id}`,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' })
const notifications = [12, 13, 14].map((number) => ({
  id: `n${number}`, updated_at: '2026-08-01T00:00:00Z', reason: 'mention',
  repository: { full_name: 'acme/widgets' },
  subject: { url: `https://api.github.com/repos/acme/widgets/issues/${number}`, type: 'Issue', title: `Issue ${number}` } }))
/** Three pages of ten comments for the paginated workload. */
const commentsPages = [0, 1, 2].map((page) =>
  Array.from({ length: 10 }, (_, index) => comment(page * 10 + index + 1, 12)))
const ETAG = 'W/"stage-d-benchmark-etag"'
module.exports = { issue, comment, notifications, commentsPages, ETAG }
