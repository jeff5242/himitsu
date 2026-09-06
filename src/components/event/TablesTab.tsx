import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { attendeeName } from '../../lib/attendee';
import TableFloorView from './TableFloorView';
import type { Attendee, Organization, OrgEvent } from '../../lib/types';

type TableView = 'cards' | 'floor' | 'list';

const VIEW_LABELS: Record<TableView, string> = { cards: '圓桌卡', floor: '平面圖', list: '清單' };

function loadViewPreference(orgId: string): TableView {
  try {
    const saved = localStorage.getItem(`himitsu:tableview:${orgId}`);
    if (saved === 'cards' || saved === 'floor' || saved === 'list') return saved;
  } catch { /* 私密視窗等環境忽略 */ }
  return 'cards';
}

export interface EventTable {
  id: string;
  table_no: number;
  capacity: number;
  label: string | null;
}

interface TablesTabProps {
  org: Organization;
  event: OrgEvent;
  attendees: Attendee[];
  canWrite: boolean;
  onChanged: () => Promise<void>;
}

/** 桌次分頁（AC-10）：建桌（容量吃設定）、指派/移出、爆桌由 DB 擋 */
export default function TablesTab({ org, event, attendees, canWrite, onChanged }: TablesTabProps) {
  const [tables, setTables] = useState<EventTable[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<TableView>(() => loadViewPreference(org.id));

  const changeView = (next: TableView) => {
    setView(next);
    try { localStorage.setItem(`himitsu:tableview:${org.id}`, next); } catch { /* 忽略 */ }
  };

  const reloadTables = useCallback(async () => {
    const { data } = await supabase
      .from('event_tables').select('id, table_no, capacity, label')
      .eq('event_id', event.id).order('table_no');
    setTables((data as EventTable[]) ?? []);
  }, [event.id]);

  useEffect(() => {
    void reloadTables();
  }, [reloadTables]);

  const active = useMemo(() => attendees.filter((a) => !a.removed_at), [attendees]);
  const unassigned = useMemo(() => active.filter((a) => a.table_no === null), [active]);
  const byTable = useMemo(() => {
    const map = new Map<number, Attendee[]>();
    for (const attendee of active) {
      if (attendee.table_no === null) continue;
      map.set(attendee.table_no, [...(map.get(attendee.table_no) ?? []), attendee]);
    }
    return map;
  }, [active]);

  const assign = async (attendeeId: string, tableNo: number | null) => {
    const { data, error } = await supabase
      .from('event_attendees').update({ table_no: tableNo }).eq('id', attendeeId).select();
    if (error) setNotice(error.message);
    else if (!data?.length) setNotice('指派被拒（權限不足）');
    else setNotice(null);
    await onChanged();
  };

  const swapTables = async (a: number, b: number) => {
    const { data, error } = await supabase.rpc('swap_tables', {
      p_event: event.id, p_a: a, p_b: b,
    });
    const result = data as { ok: boolean; error?: string; detail?: string } | null;
    if (error || !result?.ok) {
      setNotice(result?.detail ?? `互換失敗：${error?.message ?? result?.error ?? ''}`);
    } else {
      setNotice(null);
    }
    await onChanged();
  };

  const saveLabel = async (table: EventTable, label: string) => {
    const { error } = await supabase
      .from('event_tables').update({ label: label.trim() || null }).eq('id', table.id);
    setNotice(error ? `桌名儲存失敗：${error.message}` : null);
    await reloadTables();
  };

  const removeTable = async (table: EventTable) => {
    if ((byTable.get(table.table_no)?.length ?? 0) > 0) {
      setNotice(`桌 ${table.table_no} 還有人入座，先移出再刪桌`);
      return;
    }
    const { error } = await supabase.from('event_tables').delete().eq('id', table.id);
    setNotice(error ? error.message : null);
    await reloadTables();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-stone-500">
          {tables.length} 桌／未排桌 {unassigned.length} 人
        </span>
        <span className="flex rounded border border-stone-300 overflow-hidden">
          {(Object.keys(VIEW_LABELS) as TableView[]).map((key) => (
            <button key={key} onClick={() => changeView(key)}
              className={`px-3 py-1.5 ${view === key ? 'bg-amber-600 text-white font-bold' : 'bg-white hover:bg-stone-50'}`}>
              {VIEW_LABELS[key]}
            </button>
          ))}
        </span>
        <Link to={`/o/${org.slug}/events/${event.id}/screen`} target="_blank"
          className="ml-auto rounded border border-stone-300 px-3 py-1.5 hover:bg-stone-100">
          🖥 開啟現場投影頁
        </Link>
      </div>

      {canWrite && (
        <AddTableForm org={org} event={event} nextNo={(tables.at(-1)?.table_no ?? 0) + 1} onDone={reloadTables} />
      )}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      {view === 'floor' && (
        <div className="bg-white rounded-xl shadow p-6">
          <TableFloorView tables={tables} byTable={byTable} onSelect={() => changeView('cards')} />
          <p className="text-xs text-stone-400 mt-4">
            ● 綠＝已報到、灰＝已入座未報到、空心＝空位；點桌子切回圓桌卡操作。滑鼠停在點上可看姓名。
          </p>
        </div>
      )}

      {view === 'list' && (
        <section className="bg-white rounded-xl shadow divide-y divide-stone-100 text-sm">
          {tables.map((table) => {
            const seated = byTable.get(table.table_no) ?? [];
            return (
              <div key={table.id} className="p-3 flex flex-wrap items-baseline gap-3">
                <span className="font-black w-14">桌 {table.table_no}</span>
                {table.label && (
                  <span className="text-xs rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
                    {table.label}
                  </span>
                )}
                <span className={`text-xs font-bold tabular-nums ${
                  seated.length >= table.capacity ? 'text-red-600' : 'text-green-700'}`}>
                  {seated.length}／{table.capacity}
                </span>
                <span className="text-stone-600 flex-1 min-w-64">
                  {seated.map((a) => attendeeName(a)).join('、') || '（空桌）'}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {view === 'cards' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((table) => {
          const seated = byTable.get(table.table_no) ?? [];
          const isFull = seated.length >= table.capacity;
          return (
            <section key={table.id}
              className={`bg-white rounded-xl shadow p-4 space-y-2 border-t-4 ${
                isFull ? 'border-red-400' : 'border-green-500'}`}>
              <div className="flex items-center gap-2">
                <span className="font-black">桌 {table.table_no}</span>
                <TableLabel table={table} canWrite={canWrite} onSave={saveLabel} />
                <span className={`ml-auto text-sm font-bold tabular-nums ${isFull ? 'text-red-600' : 'text-green-700'}`}>
                  {seated.length}／{table.capacity}
                </span>
              </div>
              <ul className="text-sm space-y-1">
                {seated.map((attendee) => (
                  <li key={attendee.id} className="flex items-center gap-2">
                    <span>{attendeeName(attendee)}</span>
                    {canWrite && (
                      <select
                        value={String(table.table_no)}
                        onChange={(e) => {
                          const value = e.target.value;
                          void assign(attendee.id, value === 'out' ? null : Number(value));
                        }}
                        className="ml-auto rounded border border-stone-200 px-1 py-0.5 text-xs text-stone-500 bg-white"
                      >
                        {tables.map((t) => (
                          <option key={t.table_no} value={t.table_no}
                            disabled={t.table_no !== table.table_no &&
                              (byTable.get(t.table_no)?.length ?? 0) >= t.capacity}>
                            桌 {t.table_no}{t.label ? `·${t.label}` : ''}
                          </option>
                        ))}
                        <option value="out">— 移出 —</option>
                      </select>
                    )}
                  </li>
                ))}
              </ul>
              {canWrite && seated.length > 0 && tables.length > 1 && (
                <select value=""
                  onChange={(e) => { if (e.target.value) void swapTables(table.table_no, Number(e.target.value)); }}
                  className="w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-400 bg-stone-50">
                  <option value="">⇄ 與另一桌整組互換…</option>
                  {tables.filter((t) => t.table_no !== table.table_no).map((t) => (
                    <option key={t.table_no} value={t.table_no}>
                      桌 {t.table_no}{t.label ? `（${t.label}）` : ''}
                    </option>
                  ))}
                </select>
              )}
              {canWrite && !isFull && unassigned.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) void assign(e.target.value, table.table_no); }}
                  className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm text-stone-500"
                >
                  <option value="">＋ 安排入座…</option>
                  {unassigned.map((attendee) => (
                    <option key={attendee.id} value={attendee.id}>
                      #{attendee.seq_no} {attendeeName(attendee)}
                    </option>
                  ))}
                </select>
              )}
              {canWrite && seated.length === 0 && (
                <button onClick={() => void removeTable(table)}
                  className="text-xs text-stone-400 hover:text-red-600">刪除此桌</button>
              )}
            </section>
          );
        })}
      </div>}
      {tables.length === 0 && (
        <p className="text-sm text-stone-400">還沒有桌次——先建桌，容量預設吃設定中心的「每桌人數」。</p>
      )}
    </div>
  );
}

function TableLabel({
  table, canWrite, onSave,
}: { table: EventTable; canWrite: boolean; onSave: (table: EventTable, label: string) => Promise<void> }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(table.label ?? '');

  if (!canWrite) {
    return table.label ? (
      <span className="text-xs rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
        {table.label}
      </span>
    ) : null;
  }

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); void onSave(table, draft).then(() => setIsEditing(false)); }}
        className="flex items-center gap-1"
      >
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="桌名／團體名稱"
          className="w-32 rounded border border-stone-300 px-2 py-0.5 text-xs" />
        <button type="submit" className="text-xs text-amber-700 font-bold">存</button>
        <button type="button" onClick={() => { setDraft(table.label ?? ''); setIsEditing(false); }}
          className="text-xs text-stone-400">×</button>
      </form>
    );
  }

  return (
    <button onClick={() => setIsEditing(true)}
      className={`text-xs rounded-full border px-2 py-0.5 ${
        table.label
          ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
          : 'border-dashed border-stone-300 text-stone-400 hover:text-stone-600'}`}>
      {table.label ?? '＋桌名'}
    </button>
  );
}

function AddTableForm({
  org, event, nextNo, onDone,
}: { org: Organization; event: OrgEvent; nextNo: number; onDone: () => Promise<void> }) {
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setMessage(null);
    // capacity 不填 → DB trigger 套設定中心的 assembly.table_capacity
    const rows = Array.from({ length: count }, (_, i) => ({
      org_id: org.id, event_id: event.id, table_no: nextNo + i,
      label: i === 0 && label.trim() ? label.trim() : null,
    }));
    const { error } = await supabase.from('event_tables').insert(rows);
    if (error) { setMessage(error.message); return; }
    setLabel('');
    setCount(1);
    await onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-4 flex flex-wrap items-end gap-2 text-sm">
      <label className="block">
        <span className="text-stone-600">加開桌數</span>
        <input type="number" min={1} max={20} value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="mt-1 w-24 rounded border border-stone-300 px-3 py-2" />
      </label>
      <label className="block flex-1 min-w-36">
        <span className="text-stone-600">標籤（給第一桌，選填）</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：貴賓桌"
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
      </label>
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
        建桌（容量吃設定）
      </button>
      {message && <p className="w-full text-red-600">{message}</p>}
    </form>
  );
}
