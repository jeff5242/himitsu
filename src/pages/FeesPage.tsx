import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import InvoiceRow from '../components/fees/InvoiceRow';
import type { FeeInvoice, FeePeriod } from '../components/fees/feeTypes';

/** 會費頁（AC-11）：開繳批次（費率快照）→ 回報 → 財務確認 */
export default function FeesPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [periods, setPeriods] = useState<FeePeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = can('fees.write');
  const canConfirm = can('fees.confirm');
  const canReport = canManage || can('checkin.write');

  const reloadPeriods = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase
      .from('fee_periods').select('*').eq('org_id', org.id).order('created_at', { ascending: false });
    const rows = (data as FeePeriod[]) ?? [];
    setPeriods(rows);
    setSelectedId((current) => current ?? rows[0]?.id ?? null);
  }, [org]);

  const reloadInvoices = useCallback(async () => {
    if (!selectedId) { setInvoices([]); return; }
    const { data } = await supabase
      .from('fee_invoices')
      .select('*, memberships(member_no, member_type, status, identities(persons(name)))')
      .eq('period_id', selectedId);
    const rows = ((data as FeeInvoice[]) ?? [])
      .slice()
      .sort((a, b) => (a.memberships?.member_no ?? '').localeCompare(b.memberships?.member_no ?? ''));
    setInvoices(rows);
  }, [selectedId]);

  useEffect(() => { void reloadPeriods(); }, [reloadPeriods]);
  useEffect(() => { void reloadInvoices(); }, [reloadInvoices]);

  const summary = useMemo(() => {
    const counts = { unpaid: 0, reported: 0, confirmed: 0, waived: 0 };
    let confirmedAmount = 0;
    for (const invoice of invoices) {
      counts[invoice.status] += 1;
      if (invoice.status === 'confirmed') confirmedAmount += Number(invoice.amount);
    }
    return { counts, confirmedAmount };
  }, [invoices]);

  const visibleInvoices = useMemo(
    () => (statusFilter === 'all' ? invoices : invoices.filter((i) => i.status === statusFilter)),
    [invoices, statusFilter],
  );

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  return (
    <OrgLayout org={org} myRole={myRole}>
      <h2 className="text-lg font-bold">會費</h2>

      {canManage && <OpenPeriodForm orgId={org.id} onOpened={async () => { setSelectedId(null); await reloadPeriods(); }} />}

      {periods.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}
            className="rounded border border-stone-300 px-3 py-2">
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}{period.status === 'closed' ? '（已結案）' : ''}
              </option>
            ))}
          </select>
          <span className="text-stone-500">
            未繳 {summary.counts.unpaid}｜待確認 {summary.counts.reported}｜已入帳 {summary.counts.confirmed}
            （NT$ {summary.confirmedAmount.toLocaleString()}）｜免繳 {summary.counts.waived}
          </span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="ml-auto rounded border border-stone-300 px-3 py-2">
            <option value="all">全部狀態</option>
            <option value="unpaid">未繳</option>
            <option value="reported">已回報待確認</option>
            <option value="confirmed">已入帳</option>
            <option value="waived">免繳</option>
          </select>
        </div>
      )}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100 text-sm">
        {periods.length === 0 && (
          <p className="p-4 text-stone-400">還沒有開繳批次{canManage ? '——用上面的表單開第一批。' : '。'}</p>
        )}
        {periods.length > 0 && visibleInvoices.length === 0 && (
          <p className="p-4 text-stone-400">沒有符合條件的應繳單。</p>
        )}
        {visibleInvoices.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice}
            canReport={canReport} canConfirm={canConfirm}
            onNotice={setNotice} onChanged={reloadInvoices} />
        ))}
      </section>
    </OrgLayout>
  );
}

function OpenPeriodForm({ orgId, onOpened }: { orgId: string; onOpened: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const { data, error } = await supabase.rpc('open_fee_period', {
      p_org: orgId, p_name: name, p_due: dueDate || null,
    });
    const result = data as { ok: boolean; billed?: number; waived?: number; error?: string } | null;
    if (error || !result?.ok) {
      setMessage(result?.error === 'name_taken' ? '這個批次名稱已存在' : `開繳失敗：${error?.message ?? result?.error ?? ''}`);
      return;
    }
    setMessage(`已開繳：應繳 ${result.billed} 筆、免繳（榮譽/永久）${result.waived} 筆`);
    setName('');
    await onOpened();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-4 flex flex-wrap items-end gap-2 text-sm">
      <label className="block flex-1 min-w-44">
        <span className="text-stone-600">批次名稱</span>
        <input required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="例：2027 年度會費" className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-stone-600">繳費期限</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 rounded border border-stone-300 px-3 py-2" />
      </label>
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
        開繳（按類別套費率）
      </button>
      {message && <p className="w-full text-stone-600">{message}</p>}
    </form>
  );
}
