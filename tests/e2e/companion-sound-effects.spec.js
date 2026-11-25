import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('sound-effect companion preference persists and is included in full backup', async ({ page, browser }) => {
  await page.addInitScript(() => {
    let next = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => ++next,
      invoke: async (command) => command === 'plugin:event|listen' ? 1 : null,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }
    };
  });
  await page.goto('/#settings');
  const option = page.getByLabel('Hide companion for sound effects');
  await expect(option).toBeDisabled();
  await page.getByLabel('Show companion for chimes').check();
  await expect(option).toBeEnabled();
  await option.check();
  await page.reload();
  await expect(option).toBeChecked();
  const download = page.waitForEvent('download');
  await page.locator('#backup-export').click();
  const backupBytes = await readFile(await (await download).path());
  expect(JSON.parse(backupBytes.toString()).state.companionSuppressNonVoice).toBe(true);
  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto('/#settings');
  await fresh.locator('#backup-import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:backupBytes});
  await fresh.getByRole('dialog').getByRole('button',{name:'Restore backup'}).click();
  await expect(fresh.locator('#backup-status')).toContainText('Backup restored');
  await expect(fresh.getByLabel('Hide companion for sound effects')).toBeChecked();
  await freshContext.close();
});
