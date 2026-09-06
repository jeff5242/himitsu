import type { EventKind, EventStatus, IdentityKind, MembershipStatus } from './types';

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  assembly: '會員大會',
  meeting: '理監事會議',
  banquet: '宴會',
  other: '其他',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: '籌備中',
  open: '報到開放',
  closed: '已結束',
};

export const EVENT_STATUS_BADGE_CLASS: Record<EventStatus, string> = {
  draft: 'bg-stone-100 text-stone-500 border-stone-200',
  open: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-stone-200 text-stone-500 border-stone-300',
};

export const KIND_LABELS: Record<IdentityKind, string> = {
  individual_member: '個人會員',
  group_rep: '團體代表',
  honorary: '榮譽會員',
  permanent: '永久會員',
  guest: '來賓',
  staff: '工作人員',
};

export const STATUS_LABELS: Record<MembershipStatus, string> = {
  applying: '待審核',
  active: '有效',
  renewal_due: '待續會',
  honorary: '榮譽',
  permanent: '永久',
  withdrawn: '退會',
  expelled: '除籍',
  hidden: '隱藏籍',
};

/** 狀態徽章配色（Tailwind class） */
export const STATUS_BADGE_CLASS: Record<MembershipStatus, string> = {
  applying: 'bg-blue-50 text-blue-700 border-blue-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  renewal_due: 'bg-amber-50 text-amber-700 border-amber-200',
  honorary: 'bg-purple-50 text-purple-700 border-purple-200',
  permanent: 'bg-purple-50 text-purple-700 border-purple-200',
  withdrawn: 'bg-stone-100 text-stone-500 border-stone-200',
  expelled: 'bg-red-50 text-red-600 border-red-200',
  hidden: 'bg-stone-200 text-stone-500 border-stone-300',
};
