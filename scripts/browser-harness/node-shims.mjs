import { ASSETS } from './assets-map.mjs'
// Browser stand-ins for the node builtins the fixture's dependency chain imports. Only the values actually used
// at module load or on the panel's code path are real; anything else throws if called.
export const promisify = (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (err, value) => err ? reject(err) : resolve(value)))
export const execFile = (...args) => { const cb = args[args.length - 1]; if (typeof cb === 'function') cb(new Error('execFile unavailable in the browser harness')) }
export const randomUUID = () => globalThis.crypto.randomUUID()

// Compact sync SHA-256 for the harness (cache keys only, no security role).
function sha256hex(ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)) }
  const mathPow = Math.pow, maxWord = mathPow(2, 32)
  let result = ''
  const words = [], asciiBitLength = ascii.length * 8
  let hash = sha256hex.h = sha256hex.h || [], k = sha256hex.k = sha256hex.k || []
  let primeCounter = k.length
  const isComposite = {}
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0
    }
  }
  ascii += '\x80'
  while (ascii.length % 64 - 56) ascii += '\x00'
  for (let i = 0; i < ascii.length; i++) { const j = ascii.charCodeAt(i); if (j >> 8) throw new Error('ascii only'); words[i >> 2] |= j << ((3 - i) % 4) * 8 }
  words[words.length] = (asciiBitLength / maxWord) | 0
  words[words.length] = asciiBitLength
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16), oldHash = hash
    hash = hash.slice(0, 8)
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2]
      const a = hash[0], e = hash[4]
      const temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i]
        + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0)
      const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
      hash = [(temp1 + temp2) | 0].concat(hash)
      hash[4] = (hash[4] + temp1) | 0
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0
  }
  for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? '0' : '') + b.toString(16) }
  return result
}

export const createHash = (algo) => {
  if (algo !== 'sha256') throw new Error('createHash ' + algo + ' unavailable in the browser harness')
  let data = ''
  const self = { update: (chunk) => { data += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk); return self },
    digest: (enc) => enc === 'hex' ? sha256hex(unescape(encodeURIComponent(data))) : (() => { throw new Error('digest ' + enc + ' unavailable') })() }
  return self
}
const dead = (name) => () => { throw new Error(name + ' unavailable in the browser harness') }
export const readFile = dead('readFile'); export const writeFile = dead('writeFile'); export const mkdir = dead('mkdir')
export const readFileSync = (p, enc) => { const path = String(p); if (path.endsWith('package.json')) return JSON.stringify({ name: 'dsh-superagent' }); const tail = path.replace(/^https?:\/+/,'').split('/').slice(-3).join('/')
    if (ASSETS[tail]) return ASSETS[tail]
    if (/\.(md|txt|ya?ml|json|toml)$/.test(path)) return '# browser-harness placeholder asset\n'; throw new Error('readFileSync ' + path + ' unavailable in the browser harness') }
export const writeFileSync = dead('writeFileSync'); export const existsSync = (p) => String(p).endsWith('package.json')
export const mkdirSync = dead('mkdirSync'); export const readdirSync = () => []; export const copyFileSync = dead('copyFileSync')
export const rmSync = dead('rmSync'); export const unlinkSync = dead('unlinkSync'); export const statSync = dead('statSync')
export const watch = dead('watch'); export const appendFileSync = dead('appendFileSync'); export const renameSync = dead('renameSync')
export const join = (...parts) => parts.join('/').replace(/\/+/g, '/'); export const resolve = (...parts) => join(...parts)
export const dirname = (p) => p.split('/').slice(0, -1).join('/') || '/'; export const basename = (p) => p.split('/').pop()
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : '' }
export const sep = '/'; export const delimiter = ':'
export const tmpdir = () => '/tmp'; export const homedir = () => '/home/operator'; export const hostname = () => 'harness'
export const platform = () => 'linux'; export const arch = () => 'x64'
export const fileURLToPath = (url) => String(url).replace(/^file:\/\//, ''); export const pathToFileURL = (p) => 'file://' + p
export const spawn = dead('spawn'); export const exec = dead('exec'); export const execSync = dead('execSync')
export default {}
export const accessSync = dead('accessSync'); export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }
export const isAbsolute = (p) => p.startsWith('/'); export const lstat = dead('lstat'); export const readdir = dead('readdir')
export const rename = dead('rename'); export const unlink = dead('unlink')
export const mkdtemp = dead('mkdtemp'); export const realpath = dead('realpath'); export const realpathSync = (p) => p
export const rmdir = dead('rmdir'); export const stat = dead('stat'); export const rm = dead('rm'); export const cp = dead('cp')
export const open = dead('open'); export const opendir = dead('opendir'); export const symlink = dead('symlink')
export const readlink = dead('readlink'); export const chmod = dead('chmod'); export const chown = dead('chown')
export const utimes = dead('utimes'); export const truncate = dead('truncate'); export const copyFile = dead('copyFile')
export const appendFile = dead('appendFile'); export const access = dead('access')
