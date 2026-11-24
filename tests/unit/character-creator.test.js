import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, copyFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPack, decodePack, readPack } from '../../scripts/lib/character-creator.mjs';

let dir;
const masks = {'eye-x':50,'eye-y':33,'eye-w':23,'eye-h':9,'mouth-x':50,'mouth-y':42,'mouth-w':8,'mouth-h':4};
const source = () => ({format:'heartbeat-character-source',version:1,name:'Example',masks,frames:{neutral:{base:'neutral.png'}}});
async function manifest(value) { const p = path.join(dir, 'source.json'); await writeFile(p, JSON.stringify(value)); return p; }
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'heartbeat-creator-')); await copyFile('src/assets/companion/neutral.png', path.join(dir, 'neutral.png')); });
afterEach(async () => { await rm(dir, {recursive:true, force:true}); });
describe('character creator', () => {
  it('builds a pack accepted by the app validator and reads the result back', async () => {
    const pack = await buildPack(await manifest(source()));
    expect(pack.canvas).toEqual({width:512,height:512});
    const out = path.join(dir, 'pack.json'); await writeFile(out, JSON.stringify(pack));
    expect(await readPack(out)).toEqual(pack);
  });
  it('rejects mistyped slots instead of silently dropping artwork', async () => {
    const value = source(); value.frames.neutrl = value.frames.neutral;
    await expect(buildPack(await manifest(value))).rejects.toThrow('Unknown expression');
    delete value.frames.neutrl; value.frames.neutral.speak = 'neutral.png';
    await expect(buildPack(await manifest(value))).rejects.toThrow('Unknown frame mode');
  });
  it('rejects traversal and symlinks outside the source folder', async () => {
    const outside = dir + '-outside.png';
    await copyFile(path.join(dir, 'neutral.png'), outside);
    try {
      const value = source(); value.frames.neutral.base = '../' + path.basename(outside);
      await expect(buildPack(await manifest(value))).rejects.toThrow('escapes manifest directory');
      await symlink(outside, path.join(dir, 'link.png')); value.frames.neutral.base = 'link.png';
      await expect(buildPack(await manifest(value))).rejects.toThrow('escapes manifest directory');
    } finally { await rm(outside, {force:true}); }
  });
  it('detects corrupt PNGs that have valid-looking headers', async () => {
    const png = await readFile(path.join(dir, 'neutral.png'));
    await writeFile(path.join(dir, 'neutral.png'), png.subarray(0, 33));
    const pack = await buildPack(await manifest(source()));
    await expect(decodePack(pack)).rejects.toThrow('PNG cannot be decoded');
  });
  it('rejects invalid image data', async () => {
    await writeFile(path.join(dir, 'neutral.png'), 'not a PNG');
    await expect(buildPack(await manifest(source()))).rejects.toThrow('Invalid PNG');
  });
});
