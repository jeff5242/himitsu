import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AGENT_ERROR_LABELS, agentCheckin, agentPickup, fetchAgentData, fetchAgentStatus,
} from '../lib/agentClient';
import type { AgentData, AgentStatus } from '../lib/agentClient';
import { attendeeAffiliation, groupByPerson } from '../lib/attendee';
import { KIND_LABELS } from '../lib/labels';

const STATUS_POLL_MS = 5_000;
const DATA_POLL_MS = 10_000;

/**
 * 報到機專用頁（EPIC-2 L15）：免登入（kiosk 帳號由本地代理代持），
 * 資料層全走 127.0.0.1 的 agent——斷網照常運作、回應永遠本機速度。
 */
export default function KioskPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [data, setData] = useState<AgentData | null>(null);
  const [agentError, setAgentError] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      setStatus(await fetchAgentStatus());
      setAgentError(false);
    } catch {
      setAgentError(true);
    }
  }, []);

  const pollData = useCallback(async () => {
    try {
      setData(await fetchAgentData());
    } catch { /* agent 未就緒——status 會顯示 */ }
  }, []);

  useEffect(() => {
    void pollStatus();
    void pollData();
    const t1 = setInterval(() => void pollStatus(), STATUS_POLL_MS);
    const t2 = setInterval(() => void pollData(), DATA_POLL_MS);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [pollStatus, pollData]);

  const pickupSet = useMemo(
    () => new Set((data?.pickups ?? []).map(([a, k]) => `${a}:${k}`)),
    [data],
  );
  const unpaidSet = useMemo(() => new Set(data?.unpaid_memberships ?? []), [data]);

  const groups = useMemo(() => groupByPerson(data?.attendees ?? []), [data]);
  const visibleGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(keyword) ||
      g.mobile?.includes(keyword) ||
      g.attendees.some((a) =>
        String(a.seq_no) === keyword ||
        (attendeeAffiliation(a) ?? '').toLowerCase().includes(keyword) ||
        a.identities?.memberships.some((m) => m.member_no.toLowerCase().includes(keyword)),
      ),
    );
  }, [groups, query]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    try {
      const result = await fn();
      setNotice(result.ok ? null : (AGENT_ERROR_LABELS[result.error ?? ''] ?? result.error ?? '操作失敗'));
    } catch {
      setNotice('本地代理無回應——確認 kiosk-agent 是否運行中');
    }
    await pollData();
    await pollStatus();
  };

  if (agentError) {
    return (
      <main className="min-h-screen bg-stone-100 flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-5xl mb-4">📟</p>
          <p className="text-xl font-bold text-stone-700">找不到本地代理</p>
          <p className="text-stone-500 mt-2">請先在本機啟動：<code className="bg-white border rounded px-2 py-1">python3 kiosk-agent.py run</code></p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <header className={`px-4 py-2 flex flex-wrap items-center gap-3 text-sm text-white ${
        status?.online ? 'bg-green-800' : 'bg-amber-600'}`}>
        <span className="font-black">🐝 HiMitsu 報到機</span>
        <span>{status?.event?.name ?? '（未綁定場次——請在後台裝置分頁綁定）'}</span>
        <span className="ml-auto flex items-center gap-3">
          <span>{status?.online ? '● 連線中' : '📴 離線模式（本機照常運作）'}</span>
          {(status?.pending ?? 0) > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold">
              待同步 {status?.pending}
            </span>
          )}
          <span className="opacity-60">{status?.device_id}</span>
        </span>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="輸入姓名／手機／序號／公司搜尋…"
          className="w-full rounded-xl border-2 border-stone-300 px-4 py-4 text-xl shadow-sm"
        />

        {notice && (
          <p className="rounded bg-red-50 border border-red-300 text-red-700 px-4 py-3 font-bold">{notice}</p>
        )}
        {!status?.ready && (
          <p className="rounded bg-stone-200 text-stone-500 px-4 py-3">
            名冊尚未就緒——agent 需先連線完成一次快照。
          </p>
        )}

        {visibleGroups.slice(0, 20).map((group) => {
          const allDone = group.attendees.every((a) => a.checked_in_at);
          return (
            <section key={group.key}
              className={`bg-white rounded-2xl shadow p-5 space-y-3 border-l-8 ${
                allDone ? 'border-green-600' : 'border-stone-200'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-black">{group.name}</span>
                {group.mobile && <span className="text-stone-500">{group.mobile}</span>}
                {group.attendees.length > 1 && (
                  <span className="rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-sm font-bold">
                    {group.attendees.length} 身分
                  </span>
                )}
                {!allDone ? (
                  <button
                    onClick={() => void act(async () => {
                      for (const attendee of group.attendees) {
                        if (attendee.checked_in_at) continue;
                        const result = await agentCheckin(attendee.id, 'kiosk');
                        if (!result.ok) return result;
                      }
                      return { ok: true };
                    })}
                    className="ml-auto rounded-xl bg-green-700 px-8 py-4 text-xl font-black text-white hover:bg-green-800"
                  >
                    {group.attendees.length > 1 ? '全部報到' : '報到'}
                  </button>
                ) : (
                  <span className="ml-auto text-green-700 text-xl font-black">✓ 已報到</span>
                )}
              </div>

              {group.attendees.map((attendee) => {
                const isUnpaid = attendee.identities?.memberships
                  .some((m) => unpaidSet.has(m.id)) ?? false;
                return (
                  <div key={attendee.id}
                    className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2 text-base">
                    <span className="font-mono text-stone-400">#{attendee.seq_no}</span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-stone-600">
                      {attendee.identities ? KIND_LABELS[attendee.identities.kind]
                        : attendee.category === 'walkin' ? '現場報名' : '來賓'}
                    </span>
                    {attendeeAffiliation(attendee) && (
                      <span className="text-stone-500 text-sm">{attendeeAffiliation(attendee)}</span>
                    )}
                    {attendee.table_no !== null && (
                      <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-sm text-amber-700 font-bold">
                        桌 {attendee.table_no}
                      </span>
                    )}
                    {isUnpaid && (
                      <span className="rounded-full bg-red-50 border border-red-300 px-2 py-0.5 text-sm text-red-600 font-bold">
                        未繳會費{data?.require_paid ? '·領取鎖定' : ''}
                      </span>
                    )}
                    {attendee.checked_in_at && (attendee as { _queued?: boolean })._queued && (
                      <span className="text-amber-700 text-sm">⏳ 待同步</span>
                    )}
                    <span className="ml-auto flex flex-wrap gap-2">
                      {(data?.items ?? []).map((item) => {
                        const issued = pickupSet.has(`${attendee.id}:${item.key}`);
                        return (
                          <button key={item.key}
                            onClick={() => void act(() => agentPickup(attendee.id, item.key, issued))}
                            className={`rounded-full border-2 px-4 py-2 font-bold ${
                              issued ? 'bg-green-50 border-green-400 text-green-700'
                                     : 'border-stone-300 text-stone-500 hover:bg-stone-50'}`}>
                            {issued ? '✓ ' : ''}{item.label}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
        {visibleGroups.length > 20 && (
          <p className="text-sm text-stone-400 text-center">
            還有 {visibleGroups.length - 20} 張卡——輸入關鍵字縮小範圍
          </p>
        )}
      </div>
    </main>
  );
}
