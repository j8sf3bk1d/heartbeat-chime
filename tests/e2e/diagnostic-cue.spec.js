import { test, expect } from '@playwright/test';

test('diagnostic panel shows current cue identity and rejects stale events', async ({page}) => {
  await page.addInitScript(() => {
    window.__listeners = {}; window.__callbacks = {}; let next = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: cb => { const id=++next; window.__callbacks[id]=cb; return id; },
      invoke: async (command,args) => {
        if (command === 'plugin:event|listen') { window.__listeners[args.event] = window.__callbacks[args.handler]; return 1; }
        return null;
      }, metadata:{currentWindow:{label:'diagnostic'}, currentWebview:{label:'diagnostic'}}
    };
  });
  await page.goto('/diagnostic.html');
  await page.waitForFunction(() => !!window.__listeners?.['heartbeat://diagnostic-cue']);
  const emit = cue => page.evaluate(cue => window.__listeners['heartbeat://diagnostic-cue']({payload:cue}), cue);
  await emit({generation:2,presetId:'laura-minute-exasperated-01-b',lineId:'laura-minute-exasperated-01',take:2,expression:'exasperated',text:"One minute and you're still fussing with that?",character:'Example',characterId:'character:12345678-0000-0000-0000-000000000000',targetAtMs:1000});
  const label=page.locator('#cue');
  await expect(label).toContainText('scheduled · requested exasperated · take 2');
  await expect(label).toContainText('still fussing');
  await expect(label).toContainText('laura-minute-exasperated-01');
  await expect(label).toContainText('Example (12345678)');
  await emit({generation:1,expression:'neutral',text:'stale'});
  await expect(label).not.toContainText('stale');
});
