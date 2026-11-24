import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('facial preview uses the same full mouth coverage at all speaking levels', async ({page}) => {
  await page.goto('/tools/character-preview/');
  if (process.env.HB_TEST_CHARACTER_PACK) {
    await page.locator('#file').setInputFiles({name:'character.json',mimeType:'application/json',buffer:await readFile(process.env.HB_TEST_CHARACTER_PACK)});
    await expect(page.locator('#status')).toContainText('Loaded');
  }
  await page.locator('#expression').selectOption('delighted');
  await page.locator('#blink').selectOption('off');
  for (const opening of ['small','medium','wide']) {
    await page.locator('#mouth').selectOption(opening);
    await expect(page.locator('#portrait-talk')).toHaveAttribute('data-active','true');
    await expect(page.locator('#portrait-talk')).toHaveAttribute('data-opening',opening);
    const style = await page.locator('#portrait-talk').evaluate(el => ({transform:getComputedStyle(el).transform, mask:getComputedStyle(el).maskImage}));
    expect(style.transform).toBe('none');
    expect(style.mask).toContain('radial-gradient');
  }
  if (process.env.HB_TEST_CHARACTER_PACK) await page.locator('.preview').screenshot({path:'/tmp/heartbeat-companion-hb123.png'});
  await page.locator('#mouth').selectOption('closed');
  await expect(page.locator('#portrait-talk')).toHaveAttribute('data-active','false');
});
