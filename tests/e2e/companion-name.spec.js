import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('custom dialogue name persists, reaches the running overlay and is included in backups', async ({page,context,browser}) => {
  await page.goto('/#settings');
  const png = await readFile('src/assets/companion/neutral.png');
  const pack = {format:'heartbeat-character-prototype',version:1,name:'Pack description',masks:{'eye-x':50,'eye-y':33,'eye-w':23,'eye-h':9,'mouth-x':50,'mouth-y':42,'mouth-w':8,'mouth-h':4},frames:{neutral:{base:`data:image/png;base64,${png.toString('base64')}`}}};
  await page.locator('#character-file').setInputFiles({name:'pack.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});
  await expect(page.locator('#companion-status')).toContainText('imported');
  const id = await page.locator('#companion-character').inputValue();
  await expect(page.locator('#companion-custom-name')).toBeDisabled();
  const overlay = await context.newPage();
  await overlay.addInitScript(() => {
    window.__callbacks = {}; window.__listeners = {}; let next = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: callback => { const id=++next; window.__callbacks[id]=callback; return id; },
      invoke: async (command,args) => {
        if (command==='plugin:event|listen') { window.__listeners[args.event]=window.__callbacks[args.handler]; return 1; }
        if (command==='overlay_ready') return {sequence:0,characterId:'builtin',text:'',durationMs:1000};
        return null;
      }
    };
  });
  await overlay.goto('/overlay.html');
  await overlay.waitForFunction(() => !!window.__listeners?.['heartbeat://overlay-cue']);
  const cue = sequence => overlay.evaluate(({id,sequence}) => window.__listeners['heartbeat://overlay-cue']({payload:{sequence,characterId:id,text:'Test',durationMs:1000}}), {id,sequence});
  await cue(1); await expect(overlay.locator('.character-name')).toHaveText('Pack description');
  await page.locator('#companion-name-mode').selectOption('custom');
  await page.locator('#companion-custom-name').fill('Example');
  await page.locator('#companion-custom-name').blur();
  await cue(2); await expect(overlay.locator('.character-name')).toHaveText('Example');
  await page.reload();
  await expect(page.locator('#companion-name-mode')).toHaveValue('custom');
  await expect(page.locator('#companion-custom-name')).toHaveValue('Example');
  const download = page.waitForEvent('download'); await page.locator('#backup-export').click();
  const backupBytes = await readFile(await (await download).path());
  const backup = JSON.parse(backupBytes.toString());
  expect(backup.state.companionNameMode).toBe('custom');
  expect(backup.state.companionCustomName).toBe('Example');
  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto('/#settings');
  await fresh.locator('#backup-import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:backupBytes});
  await fresh.getByRole('dialog').getByRole('button',{name:'Restore backup'}).click();
  await expect(fresh.locator('#backup-status')).toContainText('Backup restored');
  await expect(fresh.locator('#companion-name-mode')).toHaveValue('custom');
  await expect(fresh.locator('#companion-custom-name')).toHaveValue('Example');
  await freshContext.close();
  await page.locator('#companion-name-mode').selectOption('default');
  await cue(3); await expect(overlay.locator('.character-name')).toHaveText('Pack description');
  await overlay.close();
});
