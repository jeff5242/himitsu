// 角色與權限的顯示層定義。
// 權限的「事實」在 DB 的 himitsu.role_permissions（RLS 同源引用）；
// 這裡只放 UI 需要的常數與中文標籤，不重複矩陣內容。

export const ROLES = [
  'owner',
  'secretary_general',
  'secretary',
  'finance',
  'election_officer',
  'staff',
  'viewer',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: '負責人',
  secretary_general: '秘書長',
  secretary: '秘書',
  finance: '財務',
  election_officer: '選務',
  staff: '工作人員',
  viewer: '唯讀',
};

// 可透過邀請授予的角色（owner 移轉是日後獨立功能）
export const INVITABLE_ROLES = ROLES.filter((r) => r !== 'owner');

export const INVITE_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: '請先登入',
  forbidden: '沒有帳號管理權限',
  invalid_email: 'Email 格式不正確',
  invalid_role: '角色不正確',
  already_member: '這個 Email 已經有團隊帳號',
  not_found: '邀請不存在',
  accepted: '這份邀請已被使用',
  revoked: '這份邀請已被作廢',
  expired: '這份邀請已過期',
  email_mismatch: '登入的 Email 與受邀 Email 不符',
};
