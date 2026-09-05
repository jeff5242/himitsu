import { describe, expect, test } from 'vitest';
import { fromEditable, toEditable } from './settingsValue';

describe('toEditable', () => {
  test('renders each value type as an editable string', () => {
    expect(toEditable('text', '歡迎')).toBe('歡迎');
    expect(toEditable('number', 3000)).toBe('3000');
    expect(toEditable('boolean', true)).toBe('true');
    expect(toEditable('json', { a: 1 })).toBe('{"a":1}');
  });

  test('falls back to empty/false on type mismatch', () => {
    expect(toEditable('text', 42)).toBe('');
    expect(toEditable('number', 'abc')).toBe('');
    expect(toEditable('boolean', 'yes')).toBe('false');
  });
});

describe('fromEditable', () => {
  test('parses valid drafts back to typed values', () => {
    expect(fromEditable('text', 'hello')).toEqual({ value: 'hello' });
    expect(fromEditable('number', '42')).toEqual({ value: 42 });
    expect(fromEditable('boolean', 'true')).toEqual({ value: true });
    expect(fromEditable('json', '{"pad":3}')).toEqual({ value: { pad: 3 } });
  });

  test('returns error when number draft is empty or not numeric', () => {
    expect(fromEditable('number', '').error).toBe('請輸入數字');
    expect(fromEditable('number', 'abc').error).toBe('請輸入數字');
  });

  test('returns error when JSON draft is malformed', () => {
    expect(fromEditable('json', '{oops').error).toBe('JSON 格式不正確');
  });
});
