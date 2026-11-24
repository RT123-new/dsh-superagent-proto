/** Build one actual-App preview. No deployment or provider operations. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, '../..')
const application = resolve(process.argv[2] ?? repository)
const destination = resolve(process.argv[3] ?? resolve(repository, '../ui-redesign-evidence/preview'))
const require = createRequire(resolve(repository, 'package.json'))
const viteRequire = createRequire(require.resolve('vitest/package.json'))
const { build } = await import(viteRequire.resolve('vite'))
await mkdir(destination, { recursive: true })
await build({ configFile: false, root: here, base: './', logLevel: 'warn',
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    '@preview/app': resolve(application, 'src/client/app.tsx'),
    '@preview/locales': resolve(application, 'src/client/locales.ts'),
  } },
  build: { outDir: resolve(destination, 'assets'), emptyOutDir: true, minify: true,
    rolldownOptions: { output: { codeSplitting: false } } },
})
let html = await readFile(resolve(destination, 'assets/index.html'), 'utf8')
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const script = await readFile(resolve(destination, 'assets', match[1]), 'utf8')
  html = html.replace(match[0], () => '<script type="module">' + script.replaceAll('</script', '<\\/script') + '</script>')
}
for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  const css = await readFile(resolve(destination, 'assets', match[1]), 'utf8')
  html = html.replace(match[0], () => '<style>' + css + '</style>')
}
const output = resolve(destination, 'superagent-workspace.html')
await writeFile(output, html)
console.log(JSON.stringify({ application, output, bytes: Buffer.byteLength(html) }))
