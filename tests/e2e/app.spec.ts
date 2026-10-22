// The main flows of the app, clicked through in the browser (mock data, no accounts).
import { expect, test, type Page } from '@playwright/test'

// A signed-in user who has seen the welcome screen, with the mock's stored state set before the app starts.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('mock-auth', '1')
    const prefs = JSON.parse(localStorage.getItem('mock-prefs') ?? '{}')
    localStorage.setItem('mock-prefs', JSON.stringify({ ...prefs, onboarded: true }))
  })
})

/**
 * Network noise is not the app's bug: outside requests can fail (sandbox, offline), and an
 * outside picture the content policy blocks changes nothing on screen.
 */
const NETWORK = /^(Failed to load resource|Access to fetch at|Access to image at|Loading the image .* violates the following Content Security Policy)/

/** Errors of the app itself. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !NETWORK.test(m.text())) errors.push(m.text())
  })
  return errors
}

test('opens on Home with the icon rail and the logo', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.locator('.rail')).toBeVisible()
  await expect(page.locator('.rail-logo svg')).toBeVisible()
  await expect(page.locator('h2', { hasText: 'Ваши лайки' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a track opens in the full player, and the next one replaces its panel', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.locator('.play-fab').first().click()
  await page.getByRole('button', { name: 'Во весь экран' }).click()

  const full = page.locator('.full-player')
  await expect(full).toBeVisible()
  const before = await full.locator('.full-title').textContent()

  await full.getByRole('button', { name: 'Следующий' }).click()
  await expect(full.locator('.full-title')).not.toHaveText(before ?? '')
  // the right side has finished its change: no leaving animation left behind
  await expect(page.locator('.full-right')).not.toHaveClass(/leaving/, { timeout: 2000 })
  expect(errors).toEqual([])
})

test('the next track flies from "next up" onto the full player', async ({ page }) => {
  // no words for these tracks: the full "next up" list shows
  await page.route(/lrclib\.net/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }))
  await page.goto('/')
  await page.locator('.play-fab').first().click()
  await page.getByRole('button', { name: 'Во весь экран' }).click()
  const full = page.locator('.full-player')
  const first = full.locator('.full-next-row').first()
  await expect(first).toBeVisible()
  const next = await first.locator('.full-next-text > :first-child').textContent()
  await page.evaluate(() => {
    const w = window as unknown as { flew: boolean }
    w.flew = false
    new MutationObserver(() => {
      if (document.querySelector('.full-cover.flying')) w.flew = true
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
  })

  await full.getByRole('button', { name: 'Следующий' }).click()
  await expect(full.locator('.full-title')).toHaveText(next ?? '')
  expect(await page.evaluate(() => (window as unknown as { flew: boolean }).flew)).toBe(true)
  // it lands: nothing stays in flight
  await expect(page.locator('.flying')).toHaveCount(0, { timeout: 2000 })
})

test("settings: autoplay is off by default, what's new is there, About is last", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Профиль' }).click()
  await page.getByRole('menuitem', { name: 'Настройки' }).click()

  await expect(page.getByRole('switch', { name: 'Автопродолжение' })).toHaveAttribute('aria-checked', 'false')
  const sections = await page.locator('.settings-section h2').allTextContents()
  expect(sections).toContain('Что нового')
  expect(sections.at(-1)).toBe('О приложении')
  expect(errors).toEqual([])
})

test('settings: VK has its own account row, not connected until signed in', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Профиль' }).click()
  await page.getByRole('menuitem', { name: 'Настройки' }).click()

  const vk = page.locator('.settings-row', { has: page.locator('.settings-account-text strong', { hasText: /^ВКонтакте$/ }) })
  await expect(vk).toHaveCount(1)
  await expect(vk.locator('.settings-hint')).toHaveText('Не подключено')
  await expect(vk.getByRole('button', { name: 'Войти' })).toBeVisible()
  // the hidden VK page only comes up for someone who connected VK
  await expect(page.locator('.engine-page')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a track played from "Моя волна" stays in the list', async ({ page }) => {
  watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Моя волна' }).first().click()
  const rows = page.locator('.wave-next .tr')
  await expect(rows.first()).toBeVisible()
  const title = await rows.nth(2).locator('.tr-title').textContent()
  await rows.nth(2).click()
  await expect(page.locator('.wave-next .tr-title', { hasText: title ?? '' }).first()).toBeVisible()
})
