import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const build = resolve('work/offline-build')
let html = await readFile(resolve(build, 'index.html'), 'utf8')
const scriptPattern = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g
const stylesheetPattern = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g
const scripts = [...html.matchAll(scriptPattern)]
const styles = [...html.matchAll(stylesheetPattern)]
if (scripts.length !== 1 || styles.length !== 1) throw new Error('Expected a single portable script and stylesheet.')

const script = (await readFile(resolve(build, scripts[0][1]), 'utf8')).replace(/<\/script/gi, '<\\/script')
const css = await readFile(resolve(build, styles[0][1]), 'utf8')
if (/<\/style/i.test(css)) throw new Error('The stylesheet cannot be embedded safely.')
const favicon = (await readFile(resolve(build, 'favicon.svg'))).toString('base64')
const hash = createHash('sha256').update(script).digest('base64')
const policy = [
  "default-src 'none'", "script-src 'sha256-" + hash + "'",
  "style-src 'unsafe-inline'", 'worker-src blob:', "connect-src 'none'",
  'font-src data:', 'img-src data:', "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ')
const notices = await Promise.all([
  'LICENSE', 'THIRD-PARTY-LICENSES.md', 'HAR-PARSER-LICENSES.txt', 'licenses/react-three-fiber.txt',
].map(async (name) => name + '\n\n' + await readFile(resolve(build, name), 'utf8')))
const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

html = html
  .replace('<head>', () => '<head>\n    <meta http-equiv="Content-Security-Policy" content="' + policy + '">')
  .replace(scriptPattern, () => '<script type="module">' + script + '</script>')
  .replace(stylesheetPattern, () => '<style>' + css + '</style>')
  .replace('href="./favicon.svg"', () => 'href="data:image/svg+xml;base64,' + favicon + '"')
  .replace('</body>', () => '<template id="license-notices"><pre>' + escapeHtml(notices.join('\n\n')) + '</pre></template>\n</body>')

await mkdir('dist', { recursive: true })
await writeFile('dist/GhostLens.html', html)
console.log('Portable build: dist/GhostLens.html (' + Buffer.byteLength(html).toLocaleString('en-US') + ' bytes)')
