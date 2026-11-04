/** Header-preserving output from the deployment's configured gh CLI, never from an error message/body guess. */
export interface GithubResponse { status: number; headers: Readonly<Record<string,string>>; body: string }
export function githubResponse(raw: string): GithubResponse {
  const split = raw.search(/\r?\n\r?\n/)
  if (split < 0) throw new Error('GitHub returned no HTTP header block')
  const block = raw.slice(0,split).split(/\r?\n/)
  const status = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5]\d\d)(?: [^\r\n]*)?$/.exec(block.shift() ?? '')
  if (!status) throw new Error('GitHub returned an invalid HTTP status line')
  const headers: Record<string,string> = Object.create(null)
  for(const line of block) {
    const match = /^([!#$%&'*+.^_`|~\da-z-]+):[ \t]*([^\r\n]*)$/i.exec(line)
    if(!match) throw new Error('GitHub returned a malformed HTTP header')
    const name=match[1]!.toLowerCase(), value=match[2]!.trim()
    // Ambiguous rate/security metadata must not silently take the last value.
    if(name in headers) {
      if (['link','retry-after','x-poll-interval','x-ratelimit-remaining','x-ratelimit-limit','x-ratelimit-reset'].includes(name)) throw new Error('GitHub returned duplicate control headers')
      headers[name] += `, ${value}`
    } else headers[name]=value
  }
  const boundary = /^\r?\n\r?\n/.exec(raw.slice(split))![0].length
  return {status:Number(status[1]), headers:Object.freeze(headers),body:raw.slice(split+boundary)}
}
/** Follow only GitHub's configured repository, never another host/account/repository or a repeated page. */
export function githubNext(headers: Readonly<Record<string,string>>, repository: string): string | undefined {
  const link=headers.link
  if(!link)return undefined
  // RFC Link relation values can be quoted lists or single tokens. Split outside URLs/quotes only.
  const parts: string[] = []; let start=0, angle=false, quote=false
  for(let i=0;i<link.length;i++) {
    const ch=link[i]
    if(ch==='"'&&!angle)quote=!quote
    if(!quote&&ch==='<')angle=true
    if(!quote&&ch==='>')angle=false
    if(ch===','&&!angle&&!quote){parts.push(link.slice(start,i));start=i+1}
  }
  if(angle||quote)throw new Error('GitHub returned malformed pagination links')
  parts.push(link.slice(start))
  const next: string[]=[]
  for(const part of parts) {
    const parsed=/^\s*<([^>]+)>((?:\s*;\s*[\w-]+\s*=\s*(?:"[^"]*"|[^;\s]+))*)\s*$/.exec(part)
    if(!parsed)throw new Error('GitHub returned malformed pagination links')
    const relations=[...parsed[2]!.matchAll(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/gi)]
    if(relations.length>1)throw new Error('GitHub returned ambiguous link relations')
    const relation=(relations[0]?.[1]??relations[0]?.[2]??'').split(/\s+/)
    if(relation.includes('next'))next.push(parsed[1]!)
  }
  if(!next.length)return undefined
  if(next.length!==1)throw new Error('GitHub returned ambiguous next-page links')
  const url=new URL(next[0]!)
  const prefix=`/repos/${repository}/`
  if(url.origin!=='https://api.github.com'||url.username||url.password||url.hash||!url.pathname.startsWith(prefix))
    throw new Error('GitHub next-page link is outside the configured repository')
  return url.pathname.slice(prefix.length)+url.search
}
