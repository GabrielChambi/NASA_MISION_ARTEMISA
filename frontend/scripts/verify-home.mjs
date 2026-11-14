import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const output = new URL('../../artifacts/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))

try {
  const response = await page.goto(process.env.LUNAR_ORACLE_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  assert.equal(response.status(), 200)
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.title(), 'Lunar Oracle · Mission Control')
  assert.equal(await page.getByRole('heading', { name: 'Mission control.' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Launch & begin transit' }).isEnabled(), true)

  for (const [width, height, name] of [[1440, 900, 'desktop'], [1280, 800, 'laptop'], [768, 1024, 'tablet'], [390, 844, 'mobile'], [360, 800, 'small-mobile']]) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true })
    const layout = await page.evaluate(() => {
      const graph = document.querySelector('.diagnostics-panel').getBoundingClientRect()
      const timeline = document.querySelector('.timeline-panel').getBoundingClientRect()
      const telemetry = document.querySelector('.telemetry-panel').getBoundingClientRect()
      return { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, graphBottom: graph.bottom, graphTop: graph.top, timelineTop: timeline.top, telemetryBottom: telemetry.bottom, bodyHeight: document.body.scrollHeight }
    })
    assert.ok(layout.scrollWidth <= width, `Horizontal overflow at ${width}: ${layout.scrollWidth}`)
    assert.ok(layout.graphBottom <= layout.timelineTop, `Diagnostics overlaps timeline at ${width}`)
    assert.ok(layout.telemetryBottom <= layout.graphTop, `Telemetry overlaps diagnostics at ${width}`)
    console.log(`PASS ${name}: ${JSON.stringify(layout)}`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByLabel('Guidance systems calibrated').uncheck()
  assert.equal(await page.getByRole('button', { name: 'Launch & begin transit' }).isDisabled(), true)
  assert.equal(await page.getByText('Complete all checks to launch').isVisible(), true)
  await page.getByLabel('Guidance systems calibrated').check()
  await page.getByLabel('Select target destination').selectOption('site01')
  await page.getByRole('button', { name: 'Open mission briefing' }).click()
  assert.equal(await page.getByRole('dialog').getByRole('heading', { name: 'Connecting ridge' }).isVisible(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)

  await page.getByRole('button', { name: 'Lunar approach, T+ 72:00' }).click()
  assert.equal(await page.getByRole('button', { name: 'Lunar approach, T+ 72:00' }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('switch', { name: /Ambient effects/ }).uncheck()
  assert.equal(await page.locator('.app-shell.effects-on').count(), 0)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Launch & begin transit' }).click()
  assert.equal(await page.getByRole('button', { name: /Abort launch sequence/ }).isVisible(), true)
  await page.getByRole('button', { name: /Abort launch sequence/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Launch & begin transit' }).isEnabled(), true)
  await page.getByRole('button', { name: 'Launch & begin transit' }).click()
  await page.getByRole('heading', { name: 'The Moon is calling.' }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await page.getByRole('heading', { name: 'The Moon is calling.' }).isVisible(), true)
  assert.equal(await page.getByLabel('Select target destination').isDisabled(), true)
  assert.equal(await page.getByText('Your journey to Connecting ridge has begun.').isVisible(), true)
  await page.screenshot({ path: new URL('transit.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true })
  await page.getByRole('button', { name: 'Reset mission preview' }).click()
  assert.equal(await page.getByRole('button', { name: 'Launch & begin transit' }).isVisible(), true)
  assert.equal(await page.getByLabel('Select target destination').isEnabled(), true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Mission briefing', exact: true }).click()
  assert.equal(await page.getByRole('dialog').isVisible(), true)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  assert.deepEqual(errors, [])
  console.log('PASS: checklist, destination selection, dialogs, Escape, timeline, settings, launch, abort, countdown completion, reset, mobile navigation. No browser runtime errors.')
} finally {
  await browser.close()
}
