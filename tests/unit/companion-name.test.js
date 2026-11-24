import { describe, expect, it } from 'vitest';
import { companionDisplayName, normalizeCompanionName, readCompanionDisplayName } from '../../src/lib/companionName.js';
import { createDefaultState, normalizeState, serializeState } from '../../src/lib/state.js';

describe('companion display name', () => {
  it('uses pack name by default and handles an empty custom name safely', () => {
    expect(companionDisplayName({}, 'Pack')).toBe('Pack');
    expect(companionDisplayName({companionNameMode:'custom',companionCustomName:'  '}, 'Pack')).toBe('Pack');
    expect(companionDisplayName({companionNameMode:'custom',companionCustomName:' Example '}, 'Pack')).toBe('Example');
    expect(readCompanionDisplayName('Pack', {getItem:() => '{'})).toBe('Pack');
  });
  it('normalizes settings and keeps both the choice and name in serialized state', () => {
    const defaults = createDefaultState();
    const state = normalizeState({companionNameMode:'custom',companionCustomName:'  ' + 'A'.repeat(70) + '  '}, defaults, []);
    expect(state.companionCustomName).toHaveLength(40);
    expect(serializeState(state)).toMatchObject({companionNameMode:'custom',companionCustomName:'A'.repeat(40)});
    expect(normalizeState({}, defaults, []).companionNameMode).toBe('default');
    expect(normalizeCompanionName('  One\nTwo  ')).toBe('One Two');
  });
});
