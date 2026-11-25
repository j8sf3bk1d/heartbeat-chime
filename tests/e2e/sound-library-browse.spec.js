import {test, expect} from '@playwright/test';

test('search and combined filters narrow the compact sound list without changing tags', async ({page}) => {
  await page.goto('/#sounds');
  await page.locator('#sound-library-browser summary').click();
  await expect(page.locator('#preset-results-count')).toContainText('sounds');
  await page.locator('#preset-search').fill('minute already');
  await expect(page.locator('.preset-item')).toHaveCount(2);
  await page.locator('#preset-search').fill('station');
  await expect(page.locator('.preset-item')).toHaveCount(4);
  await page.locator('#preset-source-filter').selectOption('theme:Japanese train station');
  await page.locator('#preset-interval-filter').selectOption('15');
  await page.locator('#preset-tag-filter').selectOption('sound effect');
  await expect(page.locator('.preset-item')).toHaveCount(1);
  const row = page.locator('.preset-item').first();
  await expect(row.locator('.preset-title')).toContainText('Doors closing');
  await expect(row.locator('.preset-interval-input')).toHaveValue('15');
  await expect(page.locator('#preset-results-count')).toContainText('1 of');
  await page.locator('#preset-search').fill('nothing-could-match-this');
  await expect(page.locator('#preset-library')).toContainText('No sounds match');
  await page.locator('#preset-search').fill('');
  await expect(row.locator('.preset-interval-input')).toHaveValue('15');
});

for (const width of [375, 1200]) test(`compact library remains usable at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:800});
  await page.goto('/#sounds'); await page.locator('#sound-library-browser summary').click();
  await page.locator('#preset-search').fill('minute already');
  await expect(page.locator('.preset-item')).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('.preset-item').first().locator('.preset-preview')).toBeVisible();
  await expect(page.locator('.preset-item').first().locator('.preset-interval-input')).toBeVisible();
});
