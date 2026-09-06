import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { kvGet, kvSet } from '../lib/offlineStore';
import { addEntry, flushEntries } from '../lib/checkinQueue';
import type { QueuedCheckin, SendResult } from '../lib/checkinQueue';

const queueKey = (eventId: string) => `checkin-queue:${eventId}`;

interface CheckinResult {
  ok: boolean;
  queued?: boolean;
  error?: string;
}

/**
 * 離線報到（AC-13）：線上直打 RPC；離線（或網路錯誤）入 IndexedDB 佇列，
 * 回網自動同步。server 端 check_in 冪等＝衝突天然「先到先贏」。
 */
export function useCheckinQueue(eventId: string, onSynced: () => Promise<void>) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedCheckin[]>([]);
  const isFlushingRef = useRef(false);

  const persist = useCallback(async (next: QueuedCheckin[]) => {
    setQueue(next);
    await kvSet(queueKey(eventId), next);
  }, [eventId]);

  // 載入殘留佇列（例如上次離線後直接關頁）
  useEffect(() => {
    void kvGet<QueuedCheckin[]>(queueKey(eventId)).then((saved) => {
      if (saved?.length) setQueue(saved);
    });
  }, [eventId]);

  const sendEntry = useCallback(async (entry: QueuedCheckin): Promise<SendResult> => {
    try {
      const { data, error } = await supabase.rpc('check_in', {
        p_attendee: entry.attendeeId, p_channel: entry.channel,
      });
      if (error) return 'retry';  // 網路/暫時性錯誤：留在佇列
      const result = data as { ok: boolean; error?: string };
      if (result.ok) return 'ok';
      // 伺服器明確拒絕（已除名、活動關閉…）：丟棄，不無限重試
      return result.error === 'forbidden' ? 'retry' : 'drop';
    } catch {
      return 'retry';
    }
  }, []);

  const flush = useCallback(async () => {
    if (isFlushingRef.current || queue.length === 0 || !navigator.onLine) return;
    isFlushingRef.current = true;
    try {
      const { sent, remaining } = await flushEntries(queue, sendEntry);
      await persist(remaining);
      if (sent > 0) await onSynced();
    } finally {
      isFlushingRef.current = false;
    }
  }, [queue, sendEntry, persist, onSynced]);

  // 網路狀態監聽＋回網自動同步
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline) void flush();
  }, [isOnline, flush]);

  /** 報到：線上直打；失敗或離線入佇列（回傳 queued=true 供 UI 顯示「待同步」） */
  const checkIn = useCallback(async (attendeeId: string, channel: string): Promise<CheckinResult> => {
    const entry: QueuedCheckin = { attendeeId, channel, queuedAt: new Date().toISOString() };
    if (!navigator.onLine) {
      await persist(addEntry(queue, entry));
      return { ok: true, queued: true };
    }
    try {
      const { data, error } = await supabase.rpc('check_in', {
        p_attendee: attendeeId, p_channel: channel,
      });
      if (error) {  // 有網路旗標但請求失敗（斷線瞬間）——入佇列
        await persist(addEntry(queue, entry));
        return { ok: true, queued: true };
      }
      const result = data as { ok: boolean; error?: string };
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } catch {
      await persist(addEntry(queue, entry));
      return { ok: true, queued: true };
    }
  }, [queue, persist]);

  const queuedIds = new Set(queue.map((q) => q.attendeeId));
  return { isOnline, queuedIds, pendingCount: queue.length, checkIn, flush };
}
