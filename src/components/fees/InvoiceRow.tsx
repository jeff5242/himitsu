import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { INVOICE_STATUS_BADGE_CLASS, INVOICE_STATUS_LABELS } from './feeTypes';
import type { FeeInvoice } from './feeTypes';

interface InvoiceRowProps {
  invoice: FeeInvoice;
  canReport: boolean;
  canConfirm: boolean;
  onNotice: (message: string | null) => void;
  onChanged: () => Promise<void>;
}

/** 單筆應繳列：回報（末五碼/方式）與財務確認入帳 */
export default function InvoiceRow({ invoice, canReport, canConfirm, onNotice, onChanged }: InvoiceRowProps) {
  const [isReporting, setIsReporting] = useState(false);
  const [method, setMethod] = useState('transfer');
  const [last5, setLast5] = useState('');

  const name = invoice.memberships?.identities.persons.name ?? '（未知）';
  const isActionable = invoice.status === 'unpaid' || invoice.status === 'reported';

  const submitReport = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await supabase.rpc('report_fee_payment', {
      p_invoice: invoice.id, p_method: method, p_last5: last5 || null,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      onNotice(`回報失敗：${error?.message ?? result?.error ?? ''}`);
      return;
    }
    onNotice(null);
    setIsReporting(false);
    setLast5('');
    await onChanged();
  };

  const confirm = async () => {
    const { data, error } = await supabase.rpc('confirm_fee_payment', { p_invoice: invoice.id });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      onNotice(result?.error === 'forbidden' ? '確認入帳需要財務權限（fees.confirm）'
        : `確認失敗：${error?.message ?? result?.error ?? ''}`);
      return;
    }
    onNotice(null);
    await onChanged();
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-stone-400">{invoice.memberships?.member_no}</span>
        <span className="font-bold">{name}</span>
        <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
          {invoice.memberships?.member_type === 'group' ? '團體' : '個人'}
        </span>
        <span className="tabular-nums">NT$ {Number(invoice.amount).toLocaleString()}</span>
        <span className={`text-xs rounded-full border px-2 py-0.5 ${INVOICE_STATUS_BADGE_CLASS[invoice.status]}`}>
          {INVOICE_STATUS_LABELS[invoice.status]}
        </span>
        {invoice.last5 && <span className="text-xs text-stone-400">末五碼 {invoice.last5}</span>}
        {invoice.paid_at && (
          <span className="text-xs text-stone-400">{new Date(invoice.paid_at).toLocaleDateString('zh-TW')} 入帳</span>
        )}
        {isActionable && (
          <span className="ml-auto flex gap-2">
            {canReport && (
              <button onClick={() => setIsReporting(!isReporting)}
                className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100">
                回報繳費
              </button>
            )}
            {canConfirm && (
              <button onClick={() => void confirm()}
                className="rounded bg-green-700 px-3 py-1 text-white font-bold hover:bg-green-800">
                確認入帳
              </button>
            )}
          </span>
        )}
      </div>
      {isReporting && isActionable && (
        <form onSubmit={submitReport} className="flex flex-wrap items-center gap-2 pl-2">
          <select value={method} onChange={(e) => setMethod(e.target.value)}
            className="rounded border border-stone-300 px-2 py-1.5">
            <option value="transfer">轉帳</option>
            <option value="cash">現金</option>
            <option value="other">其他</option>
          </select>
          <input value={last5} onChange={(e) => setLast5(e.target.value)} maxLength={5}
            placeholder="末五碼（轉帳）" className="w-36 rounded border border-stone-300 px-3 py-1.5" />
          <button type="submit" className="rounded bg-amber-600 px-3 py-1.5 text-white font-bold hover:bg-amber-700">
            送出回報
          </button>
        </form>
      )}
    </div>
  );
}
