// Appearance: the user's own picture behind the interface, and themes saved, shared as a file and loaded back.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('mock-auth', '1')
    localStorage.setItem('mock-prefs', JSON.stringify({ onboarded: true }))
  })
})

// a small real picture (tests/e2e/fixtures/wall.png, 160×90)
const PICTURE = join(__dirname, 'fixtures', 'wall.png')

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Профиль' }).click()
  await page.getByRole('menuitem', { name: 'Настройки' }).click()
}

test('a picture of your own goes behind the interface, with its blur set by you', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByRole('radio', { name: 'Своя картинка' }).click()
  await page.locator('input[type=file][accept^="image/"]').setInputFiles(PICTURE)

  await expect(page.locator('img.wall-thumb')).toBeVisible()
  await expect(page.locator('.app')).toHaveClass(/wall-on/)
  await expect(page.locator('.app > .wallpaper img')).toHaveCount(1)

  const blur = page.getByRole('slider', { name: 'Размытие' })
  await blur.focus()
  await blur.press('ArrowRight')
  await expect(page.locator('.app')).toHaveAttribute('style', /--wp-blur: 19px/)

  // the picture is still there after a restart
  await page.reload()
  await expect(page.locator('.app > .wallpaper img')).toHaveCount(1)
})

test('a theme is saved, shared as a file, deleted and loaded back from the file', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByRole('radio', { name: 'Своя картинка' }).click()
  await page.locator('input[type=file][accept^="image/"]').setInputFiles(PICTURE)
  await expect(page.locator('img.wall-thumb')).toBeVisible()

  await page.getByRole('button', { name: 'Сохранить как тему' }).click()
  await page.locator('.dialog input').fill('Неон')
  await page.locator('.dialog').getByRole('button', { name: 'Сохранить' }).click()
  const card = page.locator('.theme-card', { hasText: 'Неон' })
  await expect(card).toHaveClass(/on/)

  await card.hover()
  await card.locator('.theme-more').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Сохранить в файл' }).click()])
  expect(download.suggestedFilename()).toBe('Неон.heddify-theme')
  const file = await download.path()
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  expect(saved.format).toBe('heddify-theme')
  expect(saved.background.image).toMatch(/^data:image\//)

  await card.hover()
  await card.locator('.theme-more').click()
  await page.getByRole('menuitem', { name: 'Удалить тему' }).click()
  await page.locator('.dialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(card).toHaveCount(0)

  await page.locator('input[type=file][accept*="heddify-theme"]').setInputFiles(file)
  await expect(page.locator('.theme-card', { hasText: 'Неон' })).toHaveClass(/on/)
  await expect(page.locator('.app')).toHaveClass(/wall-on/)
})
