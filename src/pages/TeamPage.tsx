import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import { INVITABLE_ROLES, INVITE_ERROR_MESSAGES, ROLE_LABELS } from '../lib/roles';
import type { Role } from '../lib/roles';
import type { Invitation, OrgUser } from '../lib/types';

/** 團隊頁：協會帳號清單＋邀請流程（發連結、待處理、作廢） */
export default function TeamPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const [members, setMembers] = useState<OrgUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const canManage = can('org_users.manage');

  const reload = useCallback(async () => {
    if (!org) return;
    const { data: memberRows } = await supabase
      .from('org_users')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at');
    setMembers((memberRows as OrgUser[]) ?? []);

    // 邀請清單只有具管理權者讀得到（RLS），其他角色拿到空陣列
    const { data: inviteRows } = await supabase
      .from('invitations')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });
    setInvitations((inviteRows as Invitation[]) ?? []);
  }, [org]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;

  return (
    <OrgLayout org={org} myRole={myRole}>
      <h2 className="text-lg font-bold">團隊帳號（{members.length}）</h2>
      <section className="bg-white rounded-xl shadow divide-y divide-stone-100 text-sm">
        {members.map((member) => (
          <div key={member.user_id} className="p-3 flex items-center gap-3">
            <span className="font-medium">{member.email ?? member.user_id.slice(0, 8)}</span>
            <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
              {ROLE_LABELS[member.role]}
            </span>
            {member.status !== 'active' && (
              <span className="text-xs text-red-500">{member.status}</span>
            )}
          </div>
        ))}
      </section>

      {canManage ? (
        <>
          <InviteForm orgId={org.id} onSent={reload} />
          <PendingInvitations invitations={invitations} onChanged={reload} />
        </>
      ) : (
        <p className="text-sm text-stone-400">邀請與帳號管理需要「負責人／秘書長」權限。</p>
      )}
    </OrgLayout>
  );
}

function InviteForm({ orgId, onSent }: { orgId: string; onSent: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('secretary');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setInviteLink(null);
    setErrorMessage(null);
    const { data, error } = await supabase.rpc('invite_user', {
      p_org: orgId,
      p_email: email,
      p_role: role,
    });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    const result = data as { ok: boolean; token?: string; error?: string };
    if (!result.ok) {
      setErrorMessage(INVITE_ERROR_MESSAGES[result.error ?? ''] ?? result.error ?? '邀請失敗');
      return;
    }
    setInviteLink(`${window.location.origin}/invite/${result.token}`);
    setEmail('');
    await onSent();
  };

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-3">
      <h3 className="font-bold">邀請成員</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 text-sm">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="受邀者 Email"
          className="flex-1 min-w-52 rounded border border-stone-300 px-3 py-2"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded border border-stone-300 px-3 py-2"
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700">
          產生邀請連結
        </button>
      </form>
      {inviteLink && (
        <div className="rounded bg-green-50 border border-green-200 p-3 text-sm space-y-1">
          <p className="text-green-800 font-bold">邀請連結已產生（7 天內有效），請自行轉給受邀者：</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all text-xs bg-white rounded border border-green-200 p-2">
              {inviteLink}
            </code>
            <button
              onClick={() => void navigator.clipboard.writeText(inviteLink)}
              className="rounded border border-green-300 px-3 py-1 hover:bg-green-100"
            >
              複製
            </button>
          </div>
        </div>
      )}
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </section>
  );
}

function PendingInvitations({
  invitations,
  onChanged,
}: {
  invitations: Invitation[];
  onChanged: () => Promise<void>;
}) {
  const pending = invitations.filter((inv) => inv.status === 'pending');
  if (pending.length === 0) return null;

  const revoke = async (id: string) => {
    await supabase.from('invitations').update({ status: 'revoked' }).eq('id', id);
    await onChanged();
  };

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-2 text-sm">
      <h3 className="font-bold">待處理邀請（{pending.length}）</h3>
      {pending.map((inv) => (
        <div key={inv.id} className="flex items-center gap-3 border-t border-stone-100 pt-2">
          <span>{inv.email}</span>
          <span className="text-xs rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
            {ROLE_LABELS[inv.role]}
          </span>
          <span className="text-xs text-stone-400">
            {new Date(inv.expires_at).toLocaleDateString('zh-TW')} 前有效
          </span>
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`)}
              className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100"
            >
              複製連結
            </button>
            <button
              onClick={() => void revoke(inv.id)}
              className="rounded border border-red-200 text-red-600 px-2 py-1 hover:bg-red-50"
            >
              作廢
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
