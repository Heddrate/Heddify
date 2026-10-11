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

/** Network noise is not the app's bug: outside requests can fail (sandbox, offline). */
const NETWORK = /^(Failed to load resource|Access to fetch at|Access to image at)/

/** Errors of the app itself. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !NETWORK.test(m.text())) errors.push(m.text())
  })
  return errors
}

test('opens on Home with the logo in the sidebar', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.locator('.sb-brand')).toContainText('Heddify')
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

test('settings: autoplay is off by default, equalizer and shortcuts are there, About is last', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Профиль' }).click()
  await page.getByRole('menuitem', { name: 'Настройки' }).click()

  await expect(page.getByRole('switch', { name: 'Автопродолжение' })).toHaveAttribute('aria-checked', 'false')
  const sections = await page.locator('.settings-section h2').allTextContents()
  expect(sections).toContain('Эквалайзер')
  expect(sections).toContain('Горячие клавиши')
  expect(sections).toContain('Что нового')
  expect(sections.at(-1)).toBe('О приложении')
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
