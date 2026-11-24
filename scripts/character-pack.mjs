#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { buildPack, decodePack, readPack } from './lib/character-creator.mjs';

const usage = 'Usage: node scripts/character-pack.mjs build <source-manifest.json> <new-output.json>\n       node scripts/character-pack.mjs validate <pack.json>';
try {
  const [command, input, output, ...extra] = process.argv.slice(2);
  if (!input || extra.length || (command === 'build' ? !output : command !== 'validate' || output)) throw new Error(usage);
  const pack = command === 'build' ? await buildPack(input) : await readPack(input);
  const results = await decodePack(pack);
  if (command === 'build') await writeFile(output, JSON.stringify(pack), {flag: 'wx'});
  console.log(`${command === 'build' ? 'Built' : 'Validated'} ${pack.name}: ${results.length} PNG frames, ${pack.canvas.width}×${pack.canvas.height}.`);
  if (results.some(frame => !frame.transparentCorner)) console.log('Visual review: some frames have no transparent corner; check for unwanted backgrounds.');
  console.log('Image decoding passed. Inspect alignment, masks and animation in the character preview before importing.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
