import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Organization } from '../lib/types';
import type { Role } from '../lib/roles';

interface OrgState {
  org: Organization | null;
  myRole: Role | null;
  perms: ReadonlySet<string>;
  isLoading: boolean;
  error: string | null;
}

const INITIAL: OrgState = {
  org: null,
  myRole: null,
  perms: new Set(),
  isLoading: true,
  error: null,
};

/** 依網址 slug 載入協會、我的角色與權限集合（權限來源＝DB 的 role_permissions，與 RLS 同源） */
export function useOrg(slug: string | undefined) {
  const { session } = useAuth();
  const [state, setState] = useState<OrgState>(INITIAL);

  useEffect(() => {
    if (!slug || !session) return;
    let isCancelled = false;

    const load = async () => {
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (orgError || !org) {
        if (!isCancelled) {
          setState({ ...INITIAL, isLoading: false, error: '找不到協會或沒有存取權' });
        }
        return;
      }

      const { data: membership } = await supabase
        .from('org_users')
        .select('role')
        .eq('org_id', org.id)
        .eq('user_id', session.user.id)
        .maybeSingle();
      const myRole = (membership?.role as Role | undefined) ?? null;

      let perms = new Set<string>();
      if (myRole) {
        const { data: rows } = await supabase
          .from('role_permissions')
          .select('perm')
          .eq('role', myRole);
        perms = new Set((rows ?? []).map((r: { perm: string }) => r.perm));
      }

      if (!isCancelled) {
        setState({ org, myRole, perms, isLoading: false, error: null });
      }
    };

    setState(INITIAL);
    void load();
    return () => {
      isCancelled = true;
    };
  }, [slug, session]);

  const can = useCallback((perm: string) => state.perms.has(perm), [state.perms]);

  return { ...state, can };
}
