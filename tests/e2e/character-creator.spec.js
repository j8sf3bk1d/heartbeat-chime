import { test, expect } from '@playwright/test';
import { buildPack } from '../../scripts/lib/character-creator.mjs';

test('creator output loads in the lab and imports into the app', async ({page}) => {
  const full = await buildPack('examples/character/character-source.json');
  test.setTimeout(120_000);
  const file = {name:'creator.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(full))};
  await page.goto('/tools/character-preview/');
  await page.locator('#file').setInputFiles(file);
  await expect(page.locator('#status')).toHaveText('Loaded Example Character in the preview.');
  await page.goto('/#settings');
  await page.locator('#character-file').setInputFiles(file);
  await expect(page.locator('#companion-character')).toHaveValue(/^character:/);
  await expect(page.locator('#companion-character option:checked')).toHaveText('Example Character');
});
