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
