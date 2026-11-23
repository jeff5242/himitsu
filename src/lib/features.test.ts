import { describe, expect, test } from 'vitest';
import { FEATURE_KEYS, isSettingCategoryVisible, parseFeatures } from './features';

describe('parseFeatures', () => {
  test('turns every feature on when the organisation has no overrides', () => {
    expect(parseFeatures([])).toEqual({ members: true, fees: true, devices: true });
  });

  test('turns off only the features overridden to false', () => {
    const rows = [
      { key: FEATURE_KEYS.members, value: false },
      { key: FEATURE_KEYS.fees, value: true },
      { key: 'checkin.require_paid', value: false },
    ];
    expect(parseFeatures(rows)).toEqual({ members: false, fees: true, devices: true });
  });

  test('ignores values that are not booleans', () => {
    expect(parseFeatures([{ key: FEATURE_KEYS.devices, value: 'false' }]).devices).toBe(true);
  });
});

describe('isSettingCategoryVisible', () => {
  const allOn = { members: true, fees: true, devices: true };

  test('hides 會員編號 when 會員 is off and 會費 when 會費 is off', () => {
    const off = { members: false, fees: false, devices: true };
    expect(isSettingCategoryVisible('會員編號', off)).toBe(false);
    expect(isSettingCategoryVisible('會費', off)).toBe(false);
    expect(isSettingCategoryVisible('報到', off)).toBe(true);
  });

  test('always shows the 功能開關 category so it can be turned back on', () => {
    expect(isSettingCategoryVisible('功能開關', { members: false, fees: false, devices: false })).toBe(true);
    expect(isSettingCategoryVisible('會費', allOn)).toBe(true);
  });
});
