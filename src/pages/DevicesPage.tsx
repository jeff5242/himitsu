import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import OrgLayout from '../components/OrgLayout';
import FeatureOffNotice from '../components/FeatureOffNotice';
import { useOrgFeatures } from '../hooks/useOrgFeatures';
import DeviceRow from '../components/devices/DeviceRow';
import type { Device } from '../components/devices/deviceTypes';
import type { OrgEvent } from '../lib/types';

const REFRESH_MS = 15_000;

/** 裝置管理（EPIC-2 AC-14/17）：註冊碼、心跳燈、遙控開關、場次綁定 */
export default function DevicesPage() {
  const { slug } = useParams();
  const { org, myRole, can, isLoading, error } = useOrg(slug);
  const features = useOrgFeatures(org?.id);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = can('devices.manage');

  const reload = useCallback(async () => {
    if (!org) return;
    const [{ data: deviceRows }, { data: eventRows }] = await Promise.all([
      supabase.from('devices').select('*').eq('org_id', org.id).order('created_at'),
      supabase.from('events').select('*').eq('org_id', org.id).order('created_at', { ascending: false }),
    ]);
    if (deviceRows) setDevices(deviceRows as Device[]);
    if (eventRows) setEvents(eventRows as OrgEvent[]);
  }, [org]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  if (isLoading) return <p className="p-8 text-stone-400">載入中…</p>;
  if (error || !org) return <p className="p-8 text-red-600">{error ?? '找不到協會'}</p>;
  if (!features.devices) {
    return (
      <OrgLayout org={org} myRole={myRole}>
        <FeatureOffNotice orgSlug={org.slug} featureLabel="裝置" />
      </OrgLayout>
    );
  }

  const createCode = async () => {
    const { data, error: rpcError } = await supabase.rpc('create_device_code', { p_org: org.id });
    const result = data as { ok: boolean; code?: string; expires_at?: string; error?: string } | null;
    if (rpcError || !result?.ok) {
      setNotice(`產碼失敗：${rpcError?.message ?? result?.error ?? ''}`);
      return;
    }
    setNotice(null);
    setCode({ value: result.code ?? '', expiresAt: result.expires_at ?? '' });
  };

  const registerCommand = code
    ? `python3 scripts/kiosk/kiosk-agent.py register \\
  --supabase-url ${import.meta.env.VITE_SUPABASE_URL} \\
  --anon-key ${import.meta.env.VITE_SUPABASE_KEY} \\
  --code ${code.value}`
    : '';

  return (
    <OrgLayout org={org} myRole={myRole}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">報到機裝置（{devices.length}）</h2>
        <span className="text-xs text-stone-400">
          待同步 &gt;0 且持續不歸零＝該機斷網且握有未回傳報到，去現場看那台機器
        </span>
        {canManage && (
          <button onClick={() => void createCode()}
            className="ml-auto rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">
            ＋ 產生註冊碼
          </button>
        )}
      </div>

      {code && (
        <section className="rounded-xl border border-green-300 bg-green-50 p-4 space-y-2">
          <p className="text-sm text-green-800">
            註冊碼（一次性、{new Date(code.expiresAt).toLocaleTimeString('zh-TW')} 前有效）：
            <code className="ml-2 text-2xl font-black tracking-widest bg-white rounded border border-green-200 px-3 py-1">
              {code.value}
            </code>
          </p>
          <p className="text-xs text-stone-500">在報到機上執行（repo 的 scripts/kiosk/ 下）：</p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-xs bg-white rounded border border-green-200 p-3 overflow-x-auto">{registerCommand}</pre>
            <button onClick={() => void navigator.clipboard.writeText(registerCommand)}
              className="rounded border border-green-300 px-3 py-1.5 text-sm hover:bg-green-100">複製</button>
          </div>
        </section>
      )}

      {notice && (
        <p className="rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{notice}</p>
      )}

      <section className="bg-white rounded-xl shadow divide-y divide-stone-100 text-sm">
        {devices.length === 0 && (
          <p className="p-4 text-stone-400">還沒有裝置——產生註冊碼後在報到機上執行註冊指令。</p>
        )}
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} events={events}
            canManage={canManage} onNotice={setNotice} onChanged={reload} />
        ))}
      </section>
      <p className="text-xs text-stone-400">列表每 15 秒自動更新；連線燈＝45 秒內有心跳。</p>
    </OrgLayout>
  );
}
