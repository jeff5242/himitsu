import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/roles';
import type { Role } from '../lib/roles';
import type { Organization } from '../lib/types';

interface OrgLayoutProps {
  org: Organization;
  myRole: Role | null;
  children: ReactNode;
}

const TAB_CLASS = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm ${isActive ? 'bg-amber-600 text-white font-bold' : 'hover:bg-stone-100'}`;

export default function OrgLayout({ org, myRole, children }: OrgLayoutProps) {
  const { session } = useAuth();
  const themeColor = typeof org.theme?.primary_color === 'string' ? org.theme.primary_color : undefined;

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <header
        className="bg-white border-b-2 border-stone-200"
        style={themeColor ? { borderBottomColor: themeColor } : undefined}
      >
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          {org.logo_url ? (
            <Link to="/"><img src={org.logo_url} alt="LOGO" className="h-7 w-7 object-contain" /></Link>
          ) : (
            <Link to="/" className="text-lg font-black">🐝</Link>
          )}
          <span className="font-bold">{org.name}</span>
          {myRole && (
            <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
              {ROLE_LABELS[myRole]}
            </span>
          )}
          <nav className="flex gap-1 ml-2">
            <NavLink to={`/o/${org.slug}/members`} className={TAB_CLASS}>成員</NavLink>
            <NavLink to={`/o/${org.slug}/events`} className={TAB_CLASS}>活動</NavLink>
            <NavLink to={`/o/${org.slug}/team`} className={TAB_CLASS}>團隊</NavLink>
            <NavLink to={`/o/${org.slug}/settings`} className={TAB_CLASS}>設定</NavLink>
          </nav>
          <div className="ml-auto text-sm text-stone-500 flex items-center gap-3">
            <span className="hidden sm:inline">{session?.user.email}</span>
            <button
              onClick={() => void supabase.auth.signOut()}
              className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100"
            >
              登出
            </button>
          </div>
        </div>
      </header>
      <div className="max-w-4xl mx-auto p-4 space-y-4">{children}</div>
    </main>
  );
}
