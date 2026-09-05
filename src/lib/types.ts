import type { Role } from './roles';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  theme: Record<string, unknown>;
  created_at: string;
}

export interface OrgUser {
  org_id: string;
  user_id: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  email: string | null;
  created_at: string;
}

export interface Person {
  id: string;
  org_id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  note: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: Role;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  created_at: string;
}

export type IdentityKind =
  | 'individual_member'
  | 'group_rep'
  | 'honorary'
  | 'permanent'
  | 'guest'
  | 'staff';

export type MembershipStatus =
  | 'applying'
  | 'active'
  | 'renewal_due'
  | 'honorary'
  | 'permanent'
  | 'withdrawn'
  | 'expelled'
  | 'hidden';

export interface Membership {
  id: string;
  identity_id: string;
  member_no: string;
  member_type: 'individual' | 'group';
  status: MembershipStatus;
  joined_at: string | null;
}

export interface IdentityWithDetails {
  id: string;
  kind: IdentityKind;
  title: string | null;
  legal_entities: { name: string } | null;
  memberships: Membership[];
}

/** 成員清單用：一個自然人聚合其所有身分與會籍（AC-5 雙身分聚合） */
export interface PersonWithDetails extends Person {
  identities: IdentityWithDetails[];
}

export interface SettingsCatalogItem {
  key: string;
  category: string;
  label: string;
  description: string | null;
  value_type: 'text' | 'number' | 'boolean' | 'json';
  default_value: unknown;
  sort: number;
}

export interface OrgSetting {
  org_id: string;
  key: string;
  value: unknown;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  org_id: string | null;
  actor: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  tbl: string;
  row_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}
