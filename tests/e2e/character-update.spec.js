import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const masks = {'eye-x':50,'eye-y':33,'eye-w':23,'eye-h':9,'mouth-x':50,'mouth-y':42,'mouth-w':8,'mouth-h':4};
async function makePack(name, image = 'neutral.png') {
  const png = await readFile((image === "neutral.png" ? "src/assets/companion/neutral.png" : "src-tauri/icons/128x128.png"));
  return {format:'heartbeat-character-prototype',version:1,name,masks,frames:{neutral:{base:`data:image/png;base64,${png.toString('base64')}`}}};
}
const file = pack => ({name:'character.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(pack))});
async function update(page, pack) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#character-update').click();
  await (await chooser).setFiles(file(pack));
}

test('update replaces the selected pack, refreshes a running overlay and survives backup', async ({page, context}) => {
  await page.goto('/#settings');
  await expect(page.locator('#character-update')).toBeDisabled();
  await page.locator('#character-file').setInputFiles(file(await makePack('Original')));
  await expect(page.locator('#companion-status')).toContainText('imported');
  const id = await page.locator('#companion-character').inputValue();
  const overlay = await context.newPage();
  await overlay.addInitScript(() => {
    window.__testCallbacks = {}; window.__testListeners = {}; let next = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: callback => { const id = ++next; window.__testCallbacks[id] = callback; return id; },
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') { window.__testListeners[args.event] = window.__testCallbacks[args.handler]; return 1; }
        if (command === 'overlay_ready') return {sequence:0, characterId:'builtin', text:'', durationMs:1000};
        return null;
      }
    };
  });
  await overlay.goto('/overlay.html');
  await overlay.waitForFunction(() => !!window.__testListeners?.['heartbeat://overlay-cue']);
  const cue = async (sequence) => overlay.evaluate(({id,sequence}) => window.__testListeners['heartbeat://overlay-cue']({payload:{sequence,characterId:id,text:'Test',durationMs:1000}}), {id,sequence});
  await cue(1);
  await expect(overlay.locator('.character-name')).toHaveText('Original');
  const originalSrc = await overlay.locator('#portrait').getAttribute('src');
  await update(page, await makePack('Updated', 'smug.png'));
  await expect(page.locator('#companion-status')).toContainText('Updated updated');
  await expect(page.locator('#companion-character')).toHaveValue(id);
  await expect(page.locator('#companion-character option')).toHaveCount(2);
  await cue(2);
  await expect(overlay.locator('.character-name')).toHaveText('Updated');
  await expect(overlay.locator('#portrait')).not.toHaveAttribute('src', originalSrc);
  await page.reload();
  await expect(page.locator('#companion-character')).toHaveValue(id);
  await expect(page.locator('#companion-character option:checked')).toHaveText('Updated');
  const download = page.waitForEvent('download'); await page.locator('#backup-export').click();
  const backup = JSON.parse((await readFile(await (await download).path())).toString());
  expect(backup.characters.packs).toHaveLength(1);
  expect(backup.characters.packs[0].pack.name).toBe('Updated');
  expect(backup.characters.selectedId).toBe(id);
  await overlay.close();
});

test('a malformed update leaves the original pack and selection untouched', async ({page}) => {
  await page.goto('/#settings');
  await page.locator('#character-file').setInputFiles(file(await makePack('Keep me')));
  await expect(page.locator('#companion-status')).toContainText('imported');
  const id = await page.locator('#companion-character').inputValue();
  await update(page, {invalid:true});
  await expect(page.locator('#companion-status')).toContainText('Could not update character');
  await expect(page.locator('#companion-character')).toHaveValue(id);
  await expect(page.locator('#companion-character option')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#companion-character option:checked')).toHaveText('Keep me');
});
