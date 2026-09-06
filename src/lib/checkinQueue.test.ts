import { describe, expect, test } from 'vitest';
import { addEntry, flushEntries } from './checkinQueue';
import type { QueuedCheckin } from './checkinQueue';

const entry = (attendeeId: string): QueuedCheckin => ({
  attendeeId, channel: 'assist', queuedAt: '2026-09-06T10:00:00Z',
});

describe('addEntry', () => {
  test('deduplicates by attendee id', () => {
    const queue = addEntry(addEntry([], entry('a1')), entry('a1'));
    expect(queue).toHaveLength(1);
  });

  test('returns a new array without mutating the original', () => {
    const original: QueuedCheckin[] = [];
    const next = addEntry(original, entry('a1'));
    expect(original).toHaveLength(0);
    expect(next).toHaveLength(1);
  });
});

describe('flushEntries（AC-13 同步）', () => {
  test('removes ok and drop entries, counts them separately', async () => {
    const queue = [entry('a1'), entry('a2'), entry('a3')];
    const results: Record<string, 'ok' | 'drop'> = { a1: 'ok', a2: 'drop', a3: 'ok' };

    const { sent, dropped, remaining } = await flushEntries(queue, async (e) => results[e.attendeeId]);

    expect(sent).toBe(2);
    expect(dropped).toBe(1);
    expect(remaining).toHaveLength(0);
  });

  test('stops at first retry and keeps FIFO order for the rest', async () => {
    const queue = [entry('a1'), entry('a2'), entry('a3')];

    const { sent, remaining } = await flushEntries(queue, async (e) =>
      e.attendeeId === 'a2' ? 'retry' : 'ok',
    );

    expect(sent).toBe(1);
    expect(remaining.map((q) => q.attendeeId)).toEqual(['a2', 'a3']);
  });
});
