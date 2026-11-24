import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { EXPRESSION_IDS, validateCharacterPack } from '../../src/lib/characterPack.js';

const LIMIT = 64 * 1024 * 1024;
const IMAGE_LIMIT = 9 * 1024 * 1024 - 32;
const MODES = ['base', 'blink', 'talk'];

async function boundedRead(file, max) {
  const info = await stat(file);
  if (!info.isFile() || info.size > max) throw new Error(`File is not a regular file or is too large: ${file}`);
  const bytes = await readFile(file);
  if (bytes.length > max) throw new Error(`File is too large: ${file}`);
  return bytes;
}

export async function readPack(file) {
  const bytes = await boundedRead(file, LIMIT);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Pack is not valid JSON.'); }
  return validateCharacterPack(value);
}

export async function buildPack(manifestPath) {
  const manifestFile = await realpath(manifestPath);
  const root = path.dirname(manifestFile);
  let manifest;
  try { manifest = JSON.parse((await boundedRead(manifestFile, 1024 * 1024)).toString('utf8')); }
  catch (error) { throw new Error(`Cannot read source manifest: ${error.message}`); }
  if (manifest?.format !== 'heartbeat-character-source' || manifest.version !== 1 || !manifest.frames || typeof manifest.frames !== 'object' || Array.isArray(manifest.frames)) throw new Error('Invalid source manifest header or frames.');
  const frames = {};
  let total = 0;
  for (const [expression, entry] of Object.entries(manifest.frames)) {
    if (!EXPRESSION_IDS.includes(expression)) throw new Error(`Unknown expression: ${expression}`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid frames for ${expression}.`);
    frames[expression] = {};
    for (const [mode, relative] of Object.entries(entry)) {
      if (!MODES.includes(mode)) throw new Error(`Unknown frame mode: ${mode}`);
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error(`Frame path must be relative to the manifest: ${relative}`);
      const candidate = await realpath(path.resolve(root, relative));
      if (!candidate.startsWith(root + path.sep)) throw new Error(`Frame escapes manifest directory: ${relative}`);
      const bytes = await boundedRead(candidate, IMAGE_LIMIT);
      total += Math.ceil(bytes.length / 3) * 4 + 22;
      if (total > LIMIT) throw new Error('Character images exceed the 64 MiB pack limit.');
      frames[expression][mode] = `data:image/png;base64,${bytes.toString('base64')}`;
    }
  }
  const pack = validateCharacterPack({format: 'heartbeat-character-prototype', version: 1, name: manifest.name, masks: manifest.masks, frames});
  if (Buffer.byteLength(JSON.stringify(pack)) > LIMIT) throw new Error('Character JSON exceeds the 64 MiB app import limit.');
  return pack;
}

// The app also decodes every PNG before import. Run the same browser image
// decoder here so a valid-looking header cannot masquerade as usable artwork.
export async function decodePack(pack) {
  const { chromium } = await import('@playwright/test');
  let browser;
  try { browser = await chromium.launch({headless: true}); }
  catch (error) { throw new Error(`Cannot start Chromium for image decoding. Run npm run test:e2e:install. ${error.message}`); }
  try {
    const page = await browser.newPage();
    const results = [];
    for (const [expression, frames] of Object.entries(pack.frames)) {
      for (const [mode, data] of Object.entries(frames)) {
        const result = await page.evaluate(async src => {
          const img = new Image(); img.src = src;
          try { await img.decode(); } catch { return null; }
          const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(img, 0, 0);
          const corners = [[0,0],[canvas.width-1,0],[0,canvas.height-1],[canvas.width-1,canvas.height-1]];
          return {width: canvas.width, height: canvas.height, transparentCorner: corners.some(([x,y]) => ctx.getImageData(x,y,1,1).data[3] < 255)};
        }, data);
        if (!result || result.width !== pack.canvas.width || result.height !== pack.canvas.height) throw new Error(`PNG cannot be decoded: ${expression} ${mode}.`);
        results.push({expression, mode, ...result});
      }
    }
    return results;
  } finally { await browser.close(); }
}
