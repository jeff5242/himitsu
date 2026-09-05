import { describe, expect, test } from 'vitest';
import { FALLBACK_RULE, formatMemberNo, parseRule } from './memberNo';

describe('formatMemberNo（需與 DB 的 next_member_no 一致）', () => {
  test('pads sequence to the configured width', () => {
    // Arrange
    const rule = { template: 'M{seq}', pad: 4 };

    // Act & Assert
    expect(formatMemberNo(rule, 1)).toBe('M0001');
    expect(formatMemberNo(rule, 80)).toBe('M0080');
  });

  test('applies custom template with prefix and separator', () => {
    expect(formatMemberNo({ template: 'TC-{seq}', pad: 3 }, 1)).toBe('TC-001');
    expect(formatMemberNo({ template: '新-{seq}', pad: 2 }, 3)).toBe('新-03');
  });

  test('does not truncate when sequence exceeds pad width', () => {
    expect(formatMemberNo({ template: 'M{seq}', pad: 2 }, 12345)).toBe('M12345');
  });

  test('keeps template unchanged when {seq} placeholder is missing', () => {
    expect(formatMemberNo({ template: 'FIXED', pad: 4 }, 7)).toBe('FIXED');
  });
});

describe('parseRule', () => {
  test('returns fallback rule when value is null or malformed', () => {
    expect(parseRule(null)).toEqual(FALLBACK_RULE);
    expect(parseRule('not-an-object')).toEqual(FALLBACK_RULE);
  });

  test('fills missing fields from fallback', () => {
    expect(parseRule({ template: 'A{seq}' })).toEqual({ template: 'A{seq}', pad: 4 });
    expect(parseRule({ pad: 6 })).toEqual({ template: 'M{seq}', pad: 6 });
  });

  test('passes through a complete rule', () => {
    expect(parseRule({ template: 'X{seq}', pad: 5 })).toEqual({ template: 'X{seq}', pad: 5 });
  });
});
