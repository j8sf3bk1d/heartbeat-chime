// IDs and tags are stable because settings and backups refer to them.
const files = import.meta.glob('../assets/themed/*.{mp3,wav}', {eager:true, query:'?url', import:'default'});
const definitions = [
  ['factory','Machine shop',[['Small ratchet',1],['Tool on bench',5],['Workshop bell',15],['Shift change',60]]],
  ['library','Public library',[['Page turn',1],['Book set down',5],['Date stamp',15],['Reading room bell',60]]],
  ['station','Japanese train station',[['Ticket gate',1],['Platform cue',5],['Doors closing',15],['Departure cue',60]]],
  ['restaurant','Restaurant',[['Teacup',1],['Glass toast',5],['Kitchen bell',15],['Dinner is ready',60]]]
];
export const THEMED_SOUNDS = definitions.flatMap(([id, label, cues]) => cues.map(([name, intervalMinutes]) => ({
  id:`theme_${id}_${intervalMinutes}`, label:`${label}: ${name}`, description:`${intervalMinutes}-minute ${label.toLowerCase()} cue.`,
  intervalMinutes, tags:['sound effect',id], sourceTheme:label
})));
export const THEMED_PROFILES = definitions.map(([id,label]) => ({
  id:`theme_${id}`,label,description:`${label} sounds for the 1, 5, 15 and 60 minute chimes. Quick setup enables those four intervals and turns off 10 and 30 minutes.`,
  intervalPresetByMinutes:Object.fromEntries([1,5,10,15,30,60].map(n => [n,`theme_${id}_${n === 10 ? 5 : n === 30 ? 15 : n}`])),
  quickIntervals:[1,5,15,60], relativeDefaultPresetId:`theme_${id}_5`, absoluteDefaultPresetId:`theme_${id}_60`
}));
export function getThemedSoundUrl(id) {
  const match = /^theme_(factory|library|station|restaurant)_(1|5|15|60)$/.exec(id || '');
  if (!match) return null;
  const file = match[1] === 'station' && match[2] === '15' ? 'station-15-balanced.wav' : `${match[1]}-${match[2]}.mp3`;
  return files[`../assets/themed/${file}`] || null;
}
