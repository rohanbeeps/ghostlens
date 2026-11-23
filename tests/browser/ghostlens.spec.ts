import { expect, test, type Locator, type Page } from '@playwright/test'

const graph = (page: Page) => page.getByRole('region', { name: 'Network Topology' })
const navigator = (page: Page) => page.getByRole('navigation', { name: 'Workspace' })
const inspector = (page: Page) => page.getByRole('region', { name: 'Request Inspector' })
const count = (page: Page) => inspector(page).locator('.results-count')
const label = (page: Page, name: string) => graph(page).getByRole('button', { name: 'Inspect domain ' + name, exact: true })

async function openDemo(page: Page, project: string) {
  await page.goto('/')
  await expect(label(page, 'nexus.test')).toBeVisible()
  if (project === 'software') {
    await expect(graph(page).getByText('Software 3D', { exact: true })).toBeVisible()
  } else {
    await expect(graph(page).locator('canvas')).toBeVisible()
    if (project === 'webgl') await expect(graph(page).getByText('Software 3D', { exact: true })).toHaveCount(0)
  }
}

async function position(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('Expected a visible graph target')
  return bounds
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentRoot = document.documentElement
    return documentRoot.scrollWidth - documentRoot.clientWidth
  })
  expect(overflow).toBe(0)
}

function fixture(entries: unknown[], name = 'synthetic.har') {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ log: { version: '1.2', entries } })) }
}

function request(url: string, status = 200, extras: Record<string, unknown> = {}) {
  return {
    request: { url, method: 'GET' },
    response: { status, _transferSize: 100 },
    startedDateTime: '2025-01-01T00:00:00Z', time: 200, _resourceType: 'fetch',
    ...extras,
  }
}

async function importFixture(page: Page, file: ReturnType<typeof fixture>) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import HAR', exact: true }).first().click()
  await page.getByRole('button', { name: 'Choose a HAR file' }).click()
  await (await chooser).setFiles(file)
  await expect(page.locator('.capture-badge')).toHaveText(file.name)
}

test('hostname label activation does not start a camera gesture', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  const hostname = 'api.nexus.test'
  const node = label(page, hostname)
  const text = graph(page).locator('.node-label').filter({ hasText: /^api\.nexus\.test$/ })
  await text.hover()
  await expect(graph(page).locator('.node-tooltip')).toContainText('22 requests')
  const before = await position(text)
  const centerX = before.x + before.width / 2
  const centerY = before.y + before.height / 2
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX + 12, centerY + 2, { steps: 4 })
  await page.mouse.up()
  await expect(node).toHaveAttribute('aria-pressed', 'true')
  await expect(count(page)).toHaveText('22 of 128 requests')
  const after = await position(text)
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(2)

  await node.focus()
  await page.keyboard.press('Enter')
  await expect(count(page)).toHaveText('128 of 128 requests')
})

test('request filters reset pagination when removed', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  await navigator(page).getByRole('button', { name: 'Requests', exact: true }).click()
  await inspector(page).getByRole('button', { name: 'Next request page' }).click()
  await expect(inspector(page).getByText('Page 2 of 8')).toBeVisible()
  const search = inspector(page).getByRole('textbox', { name: 'Search requests' })
  await search.fill('hero.avif')
  await expect(count(page)).toHaveText('1 of 128 requests')
  await search.clear()
  await expect(count(page)).toHaveText('128 of 128 requests')
  await expect(inspector(page).getByText('Page 1 of 8')).toBeVisible({ timeout: 2_000 })
})

test('graph gestures, sizing and camera controls still work', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  const host = graph(page).locator('.node-label').filter({ hasText: /^api\.nexus\.test$/ })
  const initial = await position(host)
  const zoomIn = graph(page).getByRole('button', { name: 'Zoom in', exact: true })
  const zoomOut = graph(page).getByRole('button', { name: 'Zoom out', exact: true })
  const reset = graph(page).getByRole('button', { name: 'Reset camera' })
  await zoomIn.click()
  await expect.poll(async () => Math.abs((await position(host)).x - initial.x)).toBeGreaterThan(10)
  await zoomOut.click()
  await expect.poll(async () => Math.abs((await position(host)).x - initial.x)).toBeLessThan(3)

  const stage = await position(graph(page).locator('.graph-stage'))
  const x = stage.x + stage.width * 0.48
  const y = stage.y + 32
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 65, y + 22, { steps: 9 })
  await page.mouse.up()
  await expect.poll(async () => {
    const current = await position(host)
    return Math.hypot(current.x - initial.x, current.y - initial.y)
  }).toBeGreaterThan(14)
  await reset.click()
  await expect.poll(async () => Math.abs((await position(host)).x - initial.x)).toBeLessThan(3)
  await expect(count(page)).toHaveText('128 of 128 requests')

  const bytes = graph(page).getByRole('button', { name: 'Bytes' })
  await bytes.click()
  await expect(bytes).toHaveAttribute('aria-pressed', 'true')
  if (info.project.name === 'software') {
    const pixels = await graph(page).locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      return canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 200)
    })
    expect(pixels).toBe(true)
  }
})

test('group labels select only overflow members and compose with every filter', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  const file = fixture([
    request('https://primary.test/', 200, { _resourceType: 'document' }),
    ...Array.from({ length: 21 }, (_, index) => [
      request('https://visible-' + index + '.test/one'),
      request('https://visible-' + index + '.test/two'),
    ]).flat(),
    request('https://tiny.primary.test/queued', 503),
    request('https://quiet.external.test/photo', 206, { _resourceType: 'image' }),
    request('https://tail.external.test/check', 0, { _resourceType: null }),
  ], 'grouped.har')
  await importFixture(page, file)
  await expect(count(page)).toHaveText('46 of 46 requests')
  const group = label(page, '3 more domains')
  await graph(page).locator('.node-label').filter({ hasText: /^3 more domains$/ }).click()
  await expect(group).toHaveAttribute('aria-pressed', 'true')
  await expect(count(page)).toHaveText('3 of 46 requests')
  const requestRows = inspector(page).locator('tbody tr')
  await expect(requestRows).toHaveCount(3)
  for (const host of ['tiny.primary.test', 'quiet.external.test', 'tail.external.test']) {
    await expect(requestRows.filter({ hasText: host })).toHaveCount(1)
  }
  await expect(requestRows.filter({ hasText: 'visible-' })).toHaveCount(0)

  const party = inspector(page).getByRole('combobox', { name: 'Filter by party' })
  const status = inspector(page).getByRole('combobox', { name: 'Filter by HTTP status' })
  const resource = inspector(page).getByRole('combobox', { name: 'Filter by resource type' })
  const search = inspector(page).getByRole('textbox', { name: 'Search requests' })
  await party.selectOption('third')
  await expect(count(page)).toHaveText('2 of 46 requests')
  await status.selectOption('unknown')
  await resource.selectOption('unknown')
  await expect(count(page)).toHaveText('1 of 46 requests')
  await expect(requestRows.first()).toContainText('tail.external.test')
  await status.selectOption('2')
  await resource.selectOption('image')
  await search.fill('photo')
  await expect(count(page)).toHaveText('1 of 46 requests')
  await expect(requestRows.first()).toContainText('quiet.external.test')
  await search.fill('missing')
  await expect(inspector(page).getByText('No matching requests')).toBeVisible()
  await inspector(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(group).toHaveAttribute('aria-pressed', 'false')
  await expect(count(page)).toHaveText('46 of 46 requests')
  const legend = graph(page).getByRole('button', { name: '3 grouped', exact: true })
  await legend.click()
  await expect(count(page)).toHaveText('3 of 46 requests')
  await legend.click()
  await expect(count(page)).toHaveText('46 of 46 requests')

  await navigator(page).getByRole('button', { name: 'Analytics' }).click()
  const nextDomainPage = page.getByRole('button', { name: 'Next domain page' })
  await nextDomainPage.click()
  await nextDomainPage.click()
  await page.getByRole('button', { name: 'tiny.primary.test', exact: true }).click()
  await expect(count(page)).toHaveText('1 of 46 requests')
  await navigator(page).getByRole('button', { name: 'Observatory' }).click()
  await expect(group).toHaveAttribute('aria-pressed', 'false')
  await expect(graph(page).locator('.node-label-active')).toHaveText('3 more domains')
  await graph(page).locator('.node-label').filter({ hasText: /^3 more domains$/ }).click()
  await expect(group).toHaveAttribute('aria-pressed', 'true')
  await expect(count(page)).toHaveText('3 of 46 requests')
})

test('HAR import masks private fields and emits no capture requests or storage writes', async ({ page, context }, info) => {
  const offOrigin: string[] = []
  const errors: string[] = []
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4175') offOrigin.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await openDemo(page, info.project.name)
  await page.locator('input[type=file]').setInputFiles({
    name: 'malformed.har', mimeType: 'application/json', buffer: Buffer.from('{'),
  })
  await expect(page.getByRole('alert')).toContainText('invalid JSON')
  await expect(count(page)).toHaveText('128 of 128 requests')

  const file = fixture([
    request('https://viewer:syntheticpass@origin.test/client_secret/hiddenvalue?auth=hiddenquery#hiddenfragment', 200, {
      _resourceType: 'document',
      request: {
        method: 'GET',
        url: 'https://viewer:syntheticpass@origin.test/client_secret/hiddenvalue?auth=hiddenquery#hiddenfragment',
        headers: [{ name: 'Authorization', value: 'hiddenheader' }],
      },
      response: { status: 200, content: { text: '<img id="har-preview-markup" src="https://origin.test/never-fetch">' } },
      time: 0.5,
      timings: { send: 0.1, wait: 0.4 },
    }),
    null,
  ], 'privacy.har')
  await importFixture(page, file)
  await expect(page.getByText('1 invalid or unsupported entries skipped.')).toBeVisible()
  await expect(inspector(page).locator('.waterfall-bar')).toHaveCSS('width', await inspector(page).locator('.waterfall').evaluate((bar) => getComputedStyle(bar).width))
  await inspector(page).getByRole('button', { name: 'GET /client_secret/[redacted]' }).click()
  const details = page.getByRole('dialog', { name: 'Request details' })
  await expect(details.getByText('https://origin.test/client_secret/[redacted]?[redacted]', { exact: true })).toBeVisible()
  await expect(details.getByText('Timing breakdown')).toBeVisible()
  await expect(details.getByText('0.50 ms', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/syntheticpass|hiddenvalue|hiddenquery|hiddenfragment|hiddenheader|never-fetch/)
  await expect(page.locator('#har-preview-markup')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear capture' }).click()
  await expect(page.getByRole('heading', { name: 'No capture loaded' })).toBeVisible()
  expect(await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length,
    databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length,
  }))).toEqual({ local: 0, session: 0, databases: 0, caches: 0 })
  expect(offOrigin).toEqual([])
  expect(errors).toEqual([])
})

test('desktop, tablet, and narrow layouts keep graph controls and tables usable', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(graph(page).getByRole('button', { name: 'Reset camera' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await navigator(page).getByRole('button', { name: 'Analytics' }).click()
    await expect(page.getByRole('heading', { name: 'Domain breakdown' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await navigator(page).getByRole('button', { name: 'Observatory' }).click()
    await expect(label(page, 'nexus.test')).toBeVisible()
  }
})

test.describe('mobile', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Playwright cannot emulate a touch device in Firefox')
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  test('tap on a hostname label filters requests and page fits down to 320px', async ({ page }, info) => {
    await openDemo(page, info.project.name)
    await graph(page).locator('.node-label').filter({ hasText: /^api\.nexus\.test$/ }).tap()
    await expect(count(page)).toHaveText('22 of 128 requests')
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await expectNoHorizontalOverflow(page)
      await expect(page.getByRole('button', { name: 'Import HAR', exact: true })).toBeVisible()
      const table = inspector(page).getByRole('region', { name: 'Network requests' })
      expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    }
  })
})

test('masking clears previous searches and hides identifiers throughout the application', async ({ page }, info) => {
  await openDemo(page, info.project.name)
  await importFixture(page, fixture([
    request('https://internal.example.test/sensitive-route', 503, {
      _resourceType: 'document',
      request: { url: 'https://internal.example.test/sensitive-route', method: 'SYNTHETICMETHOD' },
    }),
    request('https://internal.example.test/another-route'),
    request('https://external.example.test/third-route'),
  ], 'sensitive-filename.har'))
  await inspector(page).getByRole('textbox', { name: 'Search requests' }).fill('sensitive-route')
  await expect(count(page)).toHaveText('1 of 3 requests')
  const help = page.getByRole('button', { name: 'Privacy & help' })
  const toggle = page.getByRole('button', { name: 'Mask capture details' })
  await help.click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('.capture-badge')).toHaveText('Masked capture')
  await expect(inspector(page).getByRole('textbox')).toHaveValue('')
  await expect(label(page, 'host-1.invalid')).toBeVisible()
  await graph(page).locator('.node-label').filter({ hasText: /^host-1\.invalid$/ }).click()
  await expect(count(page)).toHaveText('2 of 3 requests')
  await inspector(page).getByRole('button', { name: '— /request/1' }).click()
  await expect(page.getByRole('dialog').getByText('host-1.invalid/request/1', { exact: true })).toBeVisible()
  const privateTerms = /internal\.example|external\.example|sensitive-route|another-route|third-route|sensitive-filename|SYNTHETICMETHOD/i
  expect(await page.locator('body').innerHTML()).not.toMatch(privateTerms)
  await page.keyboard.press('Escape')
  await navigator(page).getByRole('button', { name: 'Analytics' }).click()
  await expect(page.getByRole('heading', { name: 'Slowest requests' })).toBeVisible()
  expect(await page.locator('body').innerHTML()).not.toMatch(privateTerms)
  await help.click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(page.locator('.capture-badge')).toHaveText('sensitive-filename.har')
  await expect(page.getByRole('button', { name: 'internal.example.test', exact: true })).toBeVisible()
})

test('switches to software rendering after the WebGL context is lost', async ({ page }, info) => {
  test.skip(info.project.name !== 'webgl', 'Only the WebGL renderer can lose its WebGL context')
  await openDemo(page, info.project.name)
  const lost = await graph(page).locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return Boolean(extension)
  })
  expect(lost).toBe(true)
  await expect(graph(page).getByText('Software 3D', { exact: true })).toBeVisible()
  await graph(page).locator('.node-label').filter({ hasText: /^api\.nexus\.test$/ }).click()
  await expect(count(page)).toHaveText('22 of 128 requests')
})
