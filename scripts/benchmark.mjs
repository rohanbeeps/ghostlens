import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const host = 'http://127.0.0.1:4176'
const directory = resolve('work/benchmark')
const workers = (await readdir('dist/assets')).filter((name) => /^har\.worker-.*\.js$/.test(name))
if (workers.length !== 1) throw new Error('Run npm run build before benchmarking.')
await mkdir(directory, { recursive: true })

function syntheticCapture(total) {
  return JSON.stringify({ log: { version: '1.2', entries: Array.from({ length: total }, (_, index) => ({
    startedDateTime: '2026-01-01T00:00:00Z',
    time: 20 + index % 400,
    _resourceType: index ? 'fetch' : 'document',
    request: { url: 'https://host-' + index % 64 + '.test/api/item-' + index, method: 'GET' },
    response: { status: index % 41 ? 200 : 503, _transferSize: index % 10240 },
    timings: { wait: 10 + index % 300 },
  })) } })
}

const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt += 1) {
    if (server.exitCode !== null || attempt > 60) throw new Error('Could not start the benchmark preview.')
    if (await fetch(host).then((response) => response.ok, () => false)) break
    await setTimeout(100)
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--disable-webgl'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const waitForCount = (text) => page.waitForFunction((expected) => document.querySelector('.results-count')?.textContent === expected, text)
  const nav = page.getByRole('navigation', { name: 'Workspace' })
  const data = []
  await page.goto(host)
  await waitForCount('128 of 128 requests')
  await page.getByText('Software 3D', { exact: true }).waitFor()
  for (const count of [1000, 10_000, 40_000]) {
    const source = syntheticCapture(count)
    const path = resolve(directory, 'synthetic-' + count + '.har')
    await writeFile(path, source)
    const trials = []
    const formatted = count.toLocaleString('en-US')
    for (let trial = 0; trial < 3; trial += 1) {
      const parse = await page.evaluate(({ workerPath, source, count }) => new Promise((resolve, reject) => {
        const worker = new Worker(workerPath)
        worker.onerror = () => { worker.terminate(); reject(new Error('Benchmark parser failed to start.')) }
        worker.onmessage = ({ data }) => {
          worker.terminate()
          if (data.error || data.capture.requests.length !== count) reject(new Error(data.error ?? 'Unexpected capture count.'))
          else resolve(data.parseMs)
        }
        worker.postMessage(new Blob([source], { type: 'application/json' }))
      }), { workerPath: '/assets/' + workers[0], source, count })
      const fromImport = performance.now()
      await page.locator('input[type=file]').setInputFiles(path)
      await waitForCount(formatted + ' of ' + formatted + ' requests')
      await page.getByRole('button', { name: 'Inspect domain host-0.test', exact: true }).waitFor()
      const render = performance.now() - fromImport

      await nav.getByRole('button', { name: 'Requests', exact: true }).click()
      const search = page.getByRole('textbox', { name: 'Search requests' })
      const fromInput = performance.now()
      await search.fill('/item-' + (count - 1))
      await waitForCount('1 of ' + formatted + ' requests')
      const filter = performance.now() - fromInput
      trials.push({ parse, render, filter })
    }
    const median = (metric) => Math.round(trials.map((trial) => trial[metric]).sort((a, b) => a - b)[1] * 10) / 10
    data.push({ requests: count, parseMs: median('parse'), firstRenderMs: median('render'), filterMs: median('filter') })
  }
  const report = { browser: browser.version(), renderer: 'software', trials: 3, measurements: data }
  console.table(data)
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n')
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const closed = once(server, 'exit')
    server.kill()
    await closed
  }
}
