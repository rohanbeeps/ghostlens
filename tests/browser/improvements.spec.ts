import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const entry = (url: string, time: number, status: number, bytes?: number, wait?: number) => ({
  request: { url, method: 'GET' },
  response: { status, _transferSize: bytes },
  time,
  timings: { wait },
})
function file(name: string, entries: ReturnType<typeof entry>[]) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ log: { version: '1.2', entries } })) }
}

const baseline = file('baseline-private.har', [
  entry('https://tenant.test/private-route?session=known-demo-value', 100, 200, 100, 80),
  entry('https://tenant.test/measurement', 10, 200, 500),
])
const candidate = file('candidate-private.har', [
  entry('https://tenant.test/private-route?session=another-demo-value', 800, 503, 1100, 700),
  entry('https://tenant.test/measurement', 60, 200),
  entry('https://external.test/failure', 80, 404, 0),
])

const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' })
async function load(page: Page, name: string, data: typeof candidate) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Choose a HAR file' }).click()
  await (await chooser).setFiles(data)
}

async function expectReportDownload(page: Page, markdown: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Markdown' }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('ghostlens-report.md')
  expect(await readFile(await saved.path(), 'utf8')).toBe(markdown)
}

test('compares captures and inspects exact matches and findings', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.results-count')).toHaveText('128 of 128 requests')
  await nav(page).getByRole('button', { name: 'Compare' }).click()
  await expect(page.getByText('Load both captures to compare')).toBeVisible()
  await load(page, 'Replace baseline', baseline)
  await expect(page.getByText('baseline-private.har', { exact: false }).last()).toBeVisible()
  await load(page, 'Import candidate', candidate)
  await expect(page.getByRole('heading', { name: 'Capture differences' })).toBeVisible()
  const table = page.getByRole('region', { name: 'Comparison results' })
  const matched = table.getByRole('row', { name: /GET https:\/\/tenant\.test\/private-route/ })
  await expect(matched).toContainText('+1,000 B')
  await expect(matched).toContainText('+700 ms')
  const partial = table.getByRole('row', { name: /GET https:\/\/tenant\.test\/measurement/ })
  await expect(partial).toContainText('1/1 → 0/1 measured')
  await expect(partial.getByRole('cell').nth(1)).toContainText('—')
  await page.getByLabel('Group by').selectOption('host')
  await expect(table.getByRole('rowheader', { name: 'tenant.test', exact: true })).toBeVisible()
  await page.getByLabel('Group by').selectOption('endpoint')
  await page.getByLabel('Search comparisons').fill('private-route')

  await matched.getByRole('button', { name: /Inspect candidate requests/ }).click()
  await expect(page.locator('.results-count')).toHaveText('1 of 3 requests')
  await page.getByRole('button', { name: 'GET /private-route', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('700 ms', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await nav(page).getByRole('button', { name: 'Analytics' }).click()
  await page.getByRole('button', { name: 'Inspect third-party HTTP errors' }).click()
  await expect(page.locator('.results-count')).toHaveText('1 of 3 requests')
  await expect(page.getByRole('button', { name: 'GET /failure', exact: true })).toBeVisible()

  await nav(page).getByRole('button', { name: 'Compare' }).click()
  await page.getByRole('button', { name: 'View candidate graph' }).click()
  await expect(page.getByRole('heading', { name: 'Network Topology' })).toBeVisible()
  await expect(page.locator('.capture-badge')).toHaveText('candidate-private.har')
})

test('masks comparison identifiers and exports a masked report', async ({ page, context, browserName }) => {
  await page.goto('/')
  await expect(page.locator('.results-count')).toHaveText('128 of 128 requests')
  await nav(page).getByRole('button', { name: 'Compare' }).click()
  await load(page, 'Import candidate', candidate)
  await expect(page.getByRole('heading', { name: 'Capture differences' })).toBeVisible()
  await page.getByLabel('Search comparisons').fill('tenant.test')
  await page.getByRole('button', { name: 'Privacy & help' }).click()
  await page.getByRole('button', { name: 'Mask capture details' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Search comparisons')).toHaveValue('')
  expect(await page.locator('body').innerHTML()).not.toMatch(/candidate-private|tenant\.test|private-route|external\.test/)
  await page.getByRole('button', { name: 'View candidate graph' }).click()
  await nav(page).getByRole('button', { name: 'Analytics' }).click()
  await page.getByRole('button', { name: 'Masked report' }).click()
  const markdown = await page.getByRole('textbox', { name: 'Masked Markdown report' }).inputValue()
  expect(markdown).toContain('Requests: 3')
  expect(markdown).toContain('HTTP errors: 2 (3/3 measured)')
  expect(markdown).not.toMatch(/candidate-private|tenant\.test|private-route|external\.test/)
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Copy Markdown' }).click()
    await expect(page.getByText('Masked report copied.')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown)
  }
  await expectReportDownload(page, markdown)
})

test('single-file edition opens from disk without network and imports both captures', async ({ page }, info) => {
  const portable = info.outputPath('GhostLens.html')
  await mkdir(dirname(portable), { recursive: true })
  await copyFile(resolve('dist/GhostLens.html'), portable)
  const remoteRequests: string[] = []
  await page.route(/^https?:\/\//, (route) => {
    remoteRequests.push(route.request().url())
    return route.abort()
  })
  await page.goto(pathToFileURL(portable).href)
  await expect(page.locator('.results-count')).toHaveText('128 of 128 requests')
  await expect(page.getByRole('button', { name: 'Inspect domain nexus.test', exact: true })).toBeVisible()
  await load(page, 'Import HAR', baseline)
  await expect(page.locator('.results-count')).toHaveText('2 of 2 requests')
  await nav(page).getByRole('button', { name: 'Compare' }).click()
  await load(page, 'Import candidate', candidate)
  await expect(page.getByRole('heading', { name: 'Capture differences' })).toBeVisible()
  await page.getByRole('button', { name: 'View candidate graph' }).click()
  await nav(page).getByRole('button', { name: 'Analytics' }).click()
  await page.getByRole('button', { name: 'Masked report' }).click()
  const markdown = await page.getByRole('textbox', { name: 'Masked Markdown report' }).inputValue()
  expect(markdown).toContain('Requests: 3')
  await expectReportDownload(page, markdown)
  expect(remoteRequests).toEqual([])
})
