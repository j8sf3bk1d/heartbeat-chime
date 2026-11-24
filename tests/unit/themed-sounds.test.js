import { describe, it, expect } from 'vitest';
import { THEMED_SOUNDS, THEMED_PROFILES, getThemedSoundUrl } from '../../src/lib/themedSounds.js';
import { soundIntervalTags } from '../../src/lib/soundIntervals.js';
import { SoundEngine } from '../../src/lib/soundEngine.js';

describe('bundled themes', () => {
  it('has a playable, tagged sound for each suggested interval in each theme', () => {
    expect(THEMED_PROFILES).toHaveLength(4);
    expect(THEMED_SOUNDS).toHaveLength(16);
    const engine = new SoundEngine({});
    for (const profile of THEMED_PROFILES) for (const minutes of [1,5,15,60]) {
      const id = profile.intervalPresetByMinutes[minutes];
      const sound = THEMED_SOUNDS.find(item => item.id === id);
      expect(soundIntervalTags(sound)).toEqual([minutes]);
      expect(getThemedSoundUrl(id)).toBeTruthy();
      expect(engine.builtInVoiceUrl(id)).toBe(getThemedSoundUrl(id));
    }
    expect(getThemedSoundUrl('theme_station_15')).toContain('station-15-balanced.wav');
    expect(getThemedSoundUrl('theme_unknown_5')).toBeNull();
  });
});
