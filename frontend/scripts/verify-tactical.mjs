import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('pageerror', err => {
  console.error('PAGE ERROR:', err)
  errors.push(err.message)
})
page.on('console', msg => console.log('[BROWSER]', msg.text()))

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Verify elements are visible
  const title = await page.textContent('.topbar-brand')
  console.log('Page Title:', title)

  const statusTitle = await page.textContent('.status-title')
  console.log('Status Banner:', statusTitle)
  if (!statusTitle?.includes('SUPERVIVENCIA ASEGURADA')) {
    throw new Error(`Expected baseline to be SUPERVIVENCIA ASEGURADA, got: ${statusTitle}`)
  }

  // Capture screenshot of baseline (Nov 14 at Shackleton)
  await page.screenshot({ path: '/tmp/tactical_baseline_shackleton.png', fullPage: true })
  console.log('Saved: /tmp/tactical_baseline_shackleton.png')

  // Now trigger the hazard scenario: Click +6D (20 NOV)
  console.log('Clicking +6D (20 NOV)...')
  await page.getByRole('button', { name: /\+6D/i }).click()
  await page.waitForTimeout(1000)

  const statusAfterDelay = await page.textContent('.status-title')
  console.log('Status after +6D delay:', statusAfterDelay)
  if (!statusAfterDelay?.includes('ALERTA: FALLA CRÍTICA')) {
    throw new Error(`Expected hazard status to be ALERTA: FALLA CRÍTICA, got: ${statusAfterDelay}`)
  }
  await page.screenshot({ path: '/tmp/tactical_hazard_delay_6d.png', fullPage: true })
  console.log('Saved: /tmp/tactical_hazard_delay_6d.png')

  // Now trigger rescue: Click "+2.0 KM ESTE"
  console.log('Clicking Rescue button (+2.0 KM ESTE)...')
  const rescueBtn = page.getByRole('button', { name: /REUBICAR \+2\.0 KM ESTE/i })
  if (await rescueBtn.isVisible()) {
    await rescueBtn.click()
    await page.waitForTimeout(1000)
    const statusAfterRescue = await page.textContent('.status-title')
    console.log('Status after rescue shift:', statusAfterRescue)
    if (!statusAfterRescue?.includes('SUPERVIVENCIA ASEGURADA')) {
      throw new Error(`Expected rescued status to be SUPERVIVENCIA ASEGURADA, got: ${statusAfterRescue}`)
    }
    await page.screenshot({ path: '/tmp/tactical_rescued_mission.png', fullPage: true })
    console.log('Saved: /tmp/tactical_rescued_mission.png')
  } else {
    throw new Error('Rescue button was not visible!')
  }

  if (errors.length > 0) {
    console.error('Runtime Errors:', errors)
    process.exit(1)
  }

  console.log('ALL TACTICAL SMOKE TESTS PASSED!')
} finally {
  await browser.close()
}
