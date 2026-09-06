export interface FeePeriod {
  id: string;
  org_id: string;
  name: string;
  due_date: string | null;
  status: 'open' | 'closed';
  created_at: string;
}

export type InvoiceStatus = 'unpaid' | 'reported' | 'confirmed' | 'waived';

export interface FeeInvoice {
  id: string;
  period_id: string;
  membership_id: string;
  amount: number;
  status: InvoiceStatus;
  method: string | null;
  last5: string | null;
  reported_at: string | null;
  paid_at: string | null;
  memberships: {
    member_no: string;
    member_type: 'individual' | 'group';
    status: string;
    identities: { persons: { name: string } };
  } | null;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: '未繳',
  reported: '已回報待確認',
  confirmed: '已入帳',
  waived: '免繳',
};

export const INVOICE_STATUS_BADGE_CLASS: Record<InvoiceStatus, string> = {
  unpaid: 'bg-red-50 text-red-600 border-red-200',
  reported: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  waived: 'bg-purple-50 text-purple-700 border-purple-200',
};
