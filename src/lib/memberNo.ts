// 會員編號規則的前端鏡像：格式必須與 DB 的 himitsu.next_member_no() 一致，
// 只用於設定頁的即時預覽——實際產號一律走 DB（RPC next_member_no）。

export interface MemberNoRule {
  template: string;
  pad: number;
}

export const FALLBACK_RULE: MemberNoRule = { template: 'M{seq}', pad: 4 };

export function parseRule(value: unknown): MemberNoRule {
  if (typeof value === 'object' && value !== null) {
    const raw = value as Record<string, unknown>;
    return {
      template: typeof raw.template === 'string' ? raw.template : FALLBACK_RULE.template,
      pad: typeof raw.pad === 'number' ? raw.pad : FALLBACK_RULE.pad,
    };
  }
  return FALLBACK_RULE;
}

export function formatMemberNo(rule: MemberNoRule, seq: number): string {
  const padded = seq.toString().padStart(Math.max(rule.pad, seq.toString().length), '0');
  return rule.template.replace('{seq}', padded);
}
