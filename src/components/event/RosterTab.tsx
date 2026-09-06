import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { attendeeAffiliation, attendeeName } from '../../lib/attendee';
import { KIND_LABELS, STATUS_LABELS } from '../../lib/labels';
import type { Attendee, MembershipStatus, Organization, OrgEvent } from '../../lib/types';

interface RosterTabProps {
  org: Organization;
  event: OrgEvent;
  attendees: Attendee[];
  canWrite: boolean;
  onChanged: () => Promise<void>;
}

const IMPORTABLE_STATUSES: MembershipStatus[] = ['active', 'renewal_due', 'honorary', 'permanent'];

/** 名單分頁：會員匯入＋來賓＋除名（序號終身制——除名列保留、顯示缺號） */
export default function RosterTab({ org, event, attendees, canWrite, onChanged }: RosterTabProps) {
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const active = useMemo(() => attendees.filter((a) => !a.removed_at), [attendees]);
  const removed = useMemo(() => attendees.filter((a) => a.removed_at), [attendees]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return active;
    return active.filter((a) => {
      const name = attendeeName(a).toLowerCase();
      const affiliation = (attendeeAffiliation(a) ?? '').toLowerCase();
      const memberNo = a.identities?.memberships[0]?.member_no.toLowerCase() ?? '';
      return (
        name.includes(keyword) || affiliation.includes(keyword) ||
        memberNo.includes(keyword) || String(a.seq_no) === keyword
      );
    });
  }, [active, query]);

  const removeAttendee = async (attendee: Attendee) => {
    const { data, error } = await supabase
      .from('event_attendees')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', attendee.id)
      .select();
    if (error || !data?.length) setNotice('除名被拒（權限不足）');
    else { setNotice(null); await onChanged(); }
  };

  return (
    <div className="space-y-4">
      {canWrite && event.status !== 'closed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ImportMembersCard org={org} event={event} attendees={attendees} onDone={onChanged} />
          <AddGuestCard org={org} event={event} onDone={onChanged} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋姓名／公司／會員編號／序號…"
          className="flex-1 min-w-56 rounded border border-stone-300 px-3 py-2 text-sm" />
        <span className="text-sm text-stone-500">
          名單 {active.length} 人{removed.length > 0 && `（另有 ${removed.length} 個缺號）`}
        </span>
      </div>

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100 text-sm">
        {visible.length === 0 && <p className="p-4 text-stone-400">沒有符合的名單。</p>}
        {visible.map((attendee) => (
          <div key={attendee.id} className="p-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-stone-400 w-12">#{attendee.seq_no}</span>
            <span className="font-bold">{attendeeName(attendee)}</span>
            {attendee.identities && (
              <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
                {KIND_LABELS[attendee.identities.kind]}
                {attendee.identities.memberships[0] &&
                  `｜${attendee.identities.memberships[0].member_no}·${STATUS_LABELS[attendee.identities.memberships[0].status]}`}
              </span>
            )}
            {attendee.category !== 'member' && (
              <span className="text-xs rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-700">
                {attendee.category === 'guest' ? '來賓' : '現場報名'}
              </span>
            )}
            {attendeeAffiliation(attendee) && (
              <span className="text-stone-500">{attendeeAffiliation(attendee)}</span>
            )}
            {attendee.table_no !== null && (
              <span className="text-xs rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-amber-700">
                桌 {attendee.table_no}
              </span>
            )}
            {canWrite && (
              <button onClick={() => void removeAttendee(attendee)}
                className="ml-auto rounded border border-red-200 text-red-600 px-2 py-1 hover:bg-red-50">
                除名
              </button>
            )}
          </div>
        ))}
        {removed.length > 0 && (
          <div className="p-3 text-xs text-stone-400">
            缺號（序號終身制，不再使用）：{removed.map((a) => `#${a.seq_no} ${attendeeName(a)}`).join('、')}
          </div>
        )}
      </section>
    </div>
  );
}

function ImportMembersCard({
  org, event, attendees, onDone,
}: { org: Organization; event: OrgEvent; attendees: Attendee[]; onDone: () => Promise<void> }) {
  const [statuses, setStatuses] = useState<MembershipStatus[]>(['active', 'honorary', 'permanent']);
  const [message, setMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const toggle = (status: MembershipStatus) => {
    setStatuses(statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status]);
  };

  const handleImport = async () => {
    setIsImporting(true);
    setMessage(null);
    try {
      const { data: memberships, error } = await supabase
        .from('memberships')
        .select('identity_id, status')
        .eq('org_id', org.id)
        .in('status', statuses);
      if (error) { setMessage(`讀取會員失敗：${error.message}`); return; }

      const existing = new Set(
        attendees.filter((a) => !a.removed_at && a.identity_id).map((a) => a.identity_id),
      );
      const rows = [...new Set((memberships ?? []).map((m) => m.identity_id))]
        .filter((identityId) => !existing.has(identityId))
        .map((identityId) => ({
          org_id: org.id, event_id: event.id, identity_id: identityId,
          category: 'member', source: 'import',
        }));
      if (rows.length === 0) { setMessage('沒有可新增的會員（都已在名單上）'); return; }

      const { error: insertError } = await supabase.from('event_attendees').insert(rows);
      if (insertError) { setMessage(`匯入被拒：${insertError.message}`); return; }
      setMessage(`已匯入 ${rows.length} 人`);
      await onDone();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
      <h3 className="font-bold">從會員庫匯入</h3>
      <div className="flex flex-wrap gap-2">
        {IMPORTABLE_STATUSES.map((status) => (
          <label key={status} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={statuses.includes(status)} onChange={() => toggle(status)} />
            {STATUS_LABELS[status]}
          </label>
        ))}
      </div>
      <button onClick={() => void handleImport()} disabled={isImporting || statuses.length === 0}
        className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-40">
        {isImporting ? '匯入中…' : '匯入名單'}
      </button>
      {message && <p className="text-stone-600">{message}</p>}
    </section>
  );
}

function AddGuestCard({
  org, event, onDone,
}: { org: Organization; event: OrgEvent; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const { error } = await supabase.from('event_attendees').insert({
      org_id: org.id, event_id: event.id, category: 'guest', source: 'manual',
      guest_name: name.trim(), guest_org: company.trim() || null,
    });
    if (error) { setMessage(`新增被拒：${error.message}`); return; }
    setMessage(null);
    setName('');
    setCompany('');
    await onDone();
  };

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-2 text-sm">
      <h3 className="font-bold">加來賓</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名"
          className="flex-1 min-w-28 rounded border border-stone-300 px-3 py-2" />
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="單位（選填）"
          className="flex-1 min-w-28 rounded border border-stone-300 px-3 py-2" />
        <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
          新增
        </button>
      </form>
      {message && <p className="text-red-600">{message}</p>}
    </section>
  );
}
