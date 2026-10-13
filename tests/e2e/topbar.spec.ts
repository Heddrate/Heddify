// The top bar: the search stays on the bar's centre line and between the back button and the avatar.
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('mock-auth', '1')
    localStorage.setItem('mock-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('mock-prefs') ?? '{}'), onboarded: true }))
  })
})

const centre = (page: import('@playwright/test').Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { cy: b.y + b.height / 2, x: b.x, right: b.x + b.width }
  })

for (const width of [1280, 1080]) {
  test(`the search is on the top bar's centre line (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expect(page.locator('.search')).toBeVisible()
    const bar = await centre(page, '.topbar')
    const search = await centre(page, '.search')
    const nav = await centre(page, '.nav-btn')
    const avatar = await centre(page, '.avatar-btn')
    expect(Math.abs(search.cy - bar.cy)).toBeLessThanOrEqual(1)
    expect(Math.abs(nav.cy - bar.cy)).toBeLessThanOrEqual(1)
    expect(Math.abs(avatar.cy - bar.cy)).toBeLessThanOrEqual(1)
    // the field never runs into the back button or the avatar
    expect(search.x).toBeGreaterThan(nav.right)
    expect(search.right).toBeLessThan(avatar.x)
  })
}
