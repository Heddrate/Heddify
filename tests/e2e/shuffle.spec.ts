// Shuffle plays the list in a random order, but the list on screen never changes.
import { expect, test } from '@playwright/test'

/** A class token "on" (not part of "icon-btn"). */
const ON = /(^| )on( |$)/

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('mock-auth', '1')
    const prefs = JSON.parse(localStorage.getItem('mock-prefs') ?? '{}')
    localStorage.setItem('mock-prefs', JSON.stringify({ ...prefs, onboarded: true }))
  })
})

test('shuffling a playlist plays it at random, the list keeps its order', async ({ page }) => {
  await page.goto('/')
  await page.locator('.lib-row', { hasText: 'Ночной город' }).first().click()

  const titles = page.locator('.tr-title')
  await expect(titles.first()).toBeVisible()
  const before = await titles.allTextContents()
  expect(before.length).toBeGreaterThan(2)

  await page.getByRole('button', { name: 'Перемешать' }).first().click()
  await page.waitForTimeout(400)

  expect(await titles.allTextContents()).toEqual(before)
  await expect(page.locator('.pb-title')).toBeVisible()
})

test('the shuffle switch in the player bar turns on and off without touching the list', async ({ page }) => {
  await page.goto('/')
  await page.locator('.lib-row', { hasText: 'Ночной город' }).first().click()
  const titles = page.locator('.tr-title')
  await expect(titles.first()).toBeVisible()
  const before = await titles.allTextContents()

  await page.locator('.play-big:not(.small)').first().click()
  const bar = page.locator('.pb-controls .toggle').first()
  await bar.click()
  await expect(bar).toHaveClass(ON)
  expect(await titles.allTextContents()).toEqual(before)

  await bar.click()
  await expect(bar).not.toHaveClass(ON)
  expect(await titles.allTextContents()).toEqual(before)
})
