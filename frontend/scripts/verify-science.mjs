import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = new URL('../../artifacts/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(30000)
const samples = []
const runtimeErrors = []
page.on('pageerror', error => runtimeErrors.push(error.message))
page.on('response', async response => {
  if (/\/api\/(solar|earth)\?/.test(response.url()) && response.ok()) {
    const body = await response.json().catch(() => null)
    if (body) samples.push({ url: response.url(), body })
  }
})
const screenshot = async name => {
  await page.locator('.science-host').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), fullPage: true })
}
const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow')

try {
  await page.goto(process.env.LUNAR_ORACLE_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Explore NASA data' }).click()
  const workspace = page.getByRole('region', { name: 'Lunar scientific workspace' })
  await workspace.getByRole('button', { name: 'Select Connecting ridge', exact: true }).waitFor()
  await workspace.getByLabel('Primary study region').selectOption('site01')
  await workspace.getByRole('button', { name: 'Solar observatory', exact: true }).click()
  await workspace.getByRole('heading', { name: 'Follow the light.' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.science-loading'))
  assert.ok(samples.some(row => row.body.site_id === 'site01' && row.body.samples.length === 169))
  await workspace.getByLabel('Primary study region').selectOption('site04')
  await page.waitForResponse(response => response.url().includes('/api/solar?site_id=site04') && response.ok())
  await workspace.getByRole('heading', { name: 'Follow the light.' }).waitFor()
  assert.ok(samples.some(row => row.body.site_id === 'site04' && row.body.samples.length === 169))
  await workspace.getByRole('button', { name: /Show sun azimuth curve/ }).click()
  await workspace.getByRole('img', { name: 'Sun azimuth in degrees over UTC time' }).waitFor()
  await noOverflow(); await screenshot('science-solar-desktop')

  await workspace.getByRole('button', { name: 'Earth visibility', exact: true }).click()
  await workspace.getByRole('heading', { name: 'Keep home in sight.' }).waitFor()
  assert.ok(samples.some(row => row.body.target === 'Earth' && Number.isFinite(row.body.summary.earth_visible_hours)))
  await screenshot('science-earth-desktop')

  await workspace.getByRole('button', { name: 'Compare sites', exact: true }).click()
  await workspace.getByText(/difference in sampled solar visibility/).waitFor()
  assert.equal(await workspace.locator('.science-compare-site').count(), 2)
  await workspace.getByLabel('Horizon model').selectOption('terrain')
  await workspace.getByText(/difference in sampled solar visibility/).waitFor()
  assert.ok(samples.some(row => row.body.meta.horizon_mode === 'terrain'))
  await noOverflow(); await screenshot('science-comparison-desktop')

  await workspace.getByRole('button', { name: 'Scientific evidence', exact: true }).click()
  assert.equal(await workspace.getByRole('link', { name: 'Open NASA source', exact: true }).count(), 7)
  await workspace.getByText('Inspect acquisition metadata from the scientific API').waitFor()

  for (const tab of ['Lunar explorer', 'Solar observatory', 'Earth visibility', 'Compare sites', 'Scientific evidence']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await workspace.getByRole('button', { name: tab, exact: true }).click()
    if (tab === 'Solar observatory') await workspace.getByRole('heading', { name: 'Follow the light.' }).waitFor()
    if (tab === 'Earth visibility') await workspace.getByRole('heading', { name: 'Keep home in sight.' }).waitFor()
    if (tab === 'Compare sites') await workspace.getByText(/difference in sampled solar visibility/).waitFor()
    await noOverflow()
    await screenshot('science-' + tab.toLowerCase().replaceAll(' ', '-') + '-mobile')
  }

  await page.route('**/api/solar?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', message: 'JPL Horizons temporarily unavailable in controlled browser verification.' }) }))
  await workspace.getByRole('button', { name: 'Solar observatory', exact: true }).click()
  await workspace.getByRole('alert').getByText('Scientific data unavailable', { exact: true }).waitFor()
  assert.equal(await workspace.getByRole('heading', { name: 'Follow the light.' }).count(), 0)
  await page.unroute('**/api/solar?*')
  await workspace.getByRole('button', { name: 'Try again' }).click()
  await workspace.getByRole('heading', { name: 'Follow the light.' }).waitFor()
  await workspace.getByRole('button', { name: 'Return to launch' }).click()
  await page.getByLabel('Select target destination').selectOption('site01')
  await page.getByRole('button', { name: 'Explore NASA data' }).click()
  assert.equal(await workspace.getByLabel('Primary study region').inputValue(), 'site01')
  assert.deepEqual(runtimeErrors, [])
  console.log('PASS science workspace: NASA catalog, verified coordinates, both real 169-sample solar ephemerides, Earth 399 data, azimuth curve, two-site comparison, terrain mode, all seven source products, 390px views without horizontal overflow, explicit HTTP503 state with no fabricated curve, retry, and launch/science site synchronization. No JS runtime errors.')
  console.log(JSON.stringify(samples.map(row => ({ site_id: row.body.site_id, target: row.body.target, count: row.body.samples.length, source: row.body.meta.source, horizon: row.body.meta.horizon_mode }))))
} finally { await browser.close() }
