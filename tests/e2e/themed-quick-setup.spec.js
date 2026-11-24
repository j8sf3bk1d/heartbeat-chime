import {test, expect} from '@playwright/test';

const row = (page, n) => page.locator(`[data-interval-id="interval-${n}"]`);

test('themes preview their impact, apply together, undo, and persist without changing timers', async ({page}) => {
  await page.goto('/#chimes');
  const one = row(page,1), five = row(page,5), ten = row(page,10), fifteen = row(page,15), thirty = row(page,30), hour = row(page,60);
  const oldSound = await one.locator('.interval-preset').inputValue();
  await ten.locator('.interval-enabled').check();
  await page.locator('#sound-profile').selectOption('theme_station');
  await expect(page.locator('#sound-profile-description')).toContainText('turns off 10 and 30');
  await expect(one.locator('.interval-preset')).toHaveValue(oldSound);
  await page.locator('#sound-profile-apply').click();
  await expect(one.locator('.interval-preset')).toHaveValue('theme_station_1');
  await expect(five.locator('.interval-preset')).toHaveValue('theme_station_5');
  await expect(fifteen.locator('.interval-preset')).toHaveValue('theme_station_15');
  await expect(hour.locator('.interval-preset')).toHaveValue('theme_station_60');
  for (const element of [one,five,fifteen,hour]) await expect(element.locator('.interval-enabled')).toBeChecked();
  for (const element of [ten,thirty]) await expect(element.locator('.interval-enabled')).not.toBeChecked();
  await page.locator('#sound-profile-undo').click();
  await expect(one.locator('.interval-preset')).toHaveValue(oldSound);
  await expect(ten.locator('.interval-enabled')).toBeChecked();
  await page.locator('#sound-profile').selectOption('theme_library');
  await page.locator('#sound-profile-apply').click();
  await page.reload();
  await expect(page.locator('#sound-profile')).toHaveValue('theme_library');
  await expect(row(page,15).locator('.interval-preset')).toHaveValue('theme_library_15');
  await expect(page.locator('#sound-profile-undo')).toBeDisabled();
  await row(page,15).locator('summary').click();
  await row(page,15).locator('.interval-clip-filter').selectOption('matching');
  await expect(row(page,15).locator('.interval-preset-set option[value="theme_library_15"]')).toHaveCount(1);
  await expect(row(page,15).locator('.interval-preset-set option[value="theme_library_5"]')).toHaveCount(0);
});

test('undo does not overwrite an interval the user edited after applying', async ({page}) => {
  await page.goto('/#chimes');
  await page.locator('#sound-profile').selectOption('theme_factory');
  await page.locator('#sound-profile-apply').click();
  await row(page,1).locator('.interval-preset').selectOption('soft_chime');
  await page.locator('#sound-profile-undo').click();
  await expect(page.locator('#sound-profile-status')).toContainText('edits are intact');
  await expect(row(page,1).locator('.interval-preset')).toHaveValue('soft_chime');
});

test('a failed storage write leaves the previous setup intact', async ({page}) => {
  await page.goto('/#chimes');
  const before = await row(page,1).locator('.interval-preset').inputValue();
  await page.locator('#sound-profile').selectOption('theme_restaurant');
  await page.evaluate(() => { Storage.prototype.setItem = function() { throw new DOMException('Storage full','QuotaExceededError'); }; });
  await page.locator('#sound-profile-apply').click();
  await expect(page.locator('#sound-profile-status')).toContainText('previous settings remain');
  await expect(row(page,1).locator('.interval-preset')).toHaveValue(before);
  await expect(page.locator('#sound-profile-undo')).toBeDisabled();
});

test('full backup restores the themed setup and tag overrides on another profile', async ({browser,page}) => {
  await page.goto('/#chimes');
  await page.locator('#sound-profile').selectOption('theme_station');
  await page.locator('#sound-profile-apply').click();
  await page.goto('/#sounds');
  await page.locator('#sound-library-browser summary').click();
  const tag = page.locator('[data-preset-id="theme_station_15"].preset-interval-input');
  await tag.fill('15, 30');
  await tag.press('Tab');
  await page.goto('/#settings');
  const download = page.waitForEvent('download');
  await page.locator('#backup-export').click();
  const {readFile} = await import('node:fs/promises');
  const bytes = await readFile(await (await download).path());
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto('/#settings');
  await fresh.locator('#backup-import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:bytes});
  await fresh.getByRole('dialog').getByRole('button',{name:'Restore backup'}).click();
  await expect(fresh.locator('#backup-status')).toContainText('Backup restored');
  await fresh.goto('/#chimes');
  await expect(fresh.locator('#sound-profile')).toHaveValue('theme_station');
  await expect(row(fresh,15).locator('.interval-preset')).toHaveValue('theme_station_15');
  await expect(row(fresh,15).locator('.interval-enabled')).toBeChecked();
  await fresh.goto('/#sounds');
  await fresh.locator('#sound-library-browser summary').click();
  await expect(fresh.locator('[data-preset-id="theme_station_15"].preset-interval-input')).toHaveValue('15, 30');
  await context.close();
});
