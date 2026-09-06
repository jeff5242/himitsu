// 離線報到佇列的純邏輯（AC-13）：入列去重、同步結果分流。
// I/O（IndexedDB、RPC）在 useCheckinQueue hook；這裡保持可單元測試。

export interface QueuedCheckin {
  attendeeId: string;
  channel: string;
  queuedAt: string;
}

/** 入列（同一 attendee 只留一筆——server 端 check_in 本就冪等，這裡省流量） */
export function addEntry(queue: QueuedCheckin[], entry: QueuedCheckin): QueuedCheckin[] {
  if (queue.some((q) => q.attendeeId === entry.attendeeId)) return queue;
  return [...queue, entry];
}

export type SendResult = 'ok' | 'retry' | 'drop';

/**
 * 依序送出佇列。'ok'/'drop' 移除（drop＝伺服器明確拒絕，如已除名），
 * 'retry'（仍離線/網路錯）保留並停止——維持先進先出順序。
 */
export async function flushEntries(
  queue: QueuedCheckin[],
  send: (entry: QueuedCheckin) => Promise<SendResult>,
): Promise<{ sent: number; dropped: number; remaining: QueuedCheckin[] }> {
  let sent = 0;
  let dropped = 0;
  const remaining: QueuedCheckin[] = [];
  for (let i = 0; i < queue.length; i++) {
    const result = await send(queue[i]);
    if (result === 'ok') { sent += 1; continue; }
    if (result === 'drop') { dropped += 1; continue; }
    // retry：這筆與其後全部保留
    remaining.push(...queue.slice(i));
    break;
  }
  return { sent, dropped, remaining };
}
