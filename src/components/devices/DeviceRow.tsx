import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { isDeviceOnline } from './deviceTypes';
import type { Device } from './deviceTypes';
import type { OrgEvent } from '../../lib/types';

interface DeviceRowProps {
  device: Device;
  events: OrgEvent[];
  canManage: boolean;
  onNotice: (message: string | null) => void;
  onChanged: () => Promise<void>;
}

/** 單台裝置列：連線燈／label 點擊改名／managed 遙控／場次綁定／待同步 */
export default function DeviceRow({ device, events, canManage, onNotice, onChanged }: DeviceRowProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(device.label ?? '');
  const isOnline = isDeviceOnline(device);

  const update = async (patch: Partial<Device>) => {
    const { data, error } = await supabase
      .from('devices').update(patch).eq('id', device.id).select();
    if (error || !data?.length) onNotice('更新被拒（需要裝置管理權限）');
    else onNotice(null);
    await onChanged();
  };

  return (
    <div className="p-3 flex flex-wrap items-center gap-3">
      <span title={isOnline ? '連線中' : '離線'}
        className={`h-3 w-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-stone-300'}`} />

      {isEditingLabel ? (
        <form onSubmit={(e) => { e.preventDefault(); void update({ label: labelDraft.trim() || null }).then(() => setIsEditingLabel(false)); }}
          className="flex items-center gap-1">
          <input autoFocus value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)}
            className="w-40 rounded border border-stone-300 px-2 py-1" />
          <button type="submit" className="text-amber-700 font-bold text-xs">存</button>
        </form>
      ) : (
        <button onClick={() => canManage && setIsEditingLabel(true)}
          className={`font-bold ${canManage ? 'hover:text-amber-700' : ''}`}>
          {device.label ?? device.device_id}
        </button>
      )}

      <span className="font-mono text-xs text-stone-400">{device.device_id}</span>
      {device.ip && <span className="text-xs text-stone-500">{device.ip}</span>}
      {device.version && <span className="text-xs text-stone-400">v{device.version}</span>}

      {device.pending_count > 0 && (
        <span className="text-xs rounded-full bg-red-50 border border-red-300 px-2 py-0.5 text-red-600 font-bold">
          待同步 {device.pending_count}
        </span>
      )}

      <span className="ml-auto flex items-center gap-3">
        {canManage ? (
          <select value={device.event_id ?? ''}
            onChange={(e) => void update({ event_id: e.target.value || null })}
            className="rounded border border-stone-300 px-2 py-1 text-xs max-w-44">
            <option value="">（未綁定場次）</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-stone-500">
            {events.find((e) => e.id === device.event_id)?.name ?? '（未綁定場次）'}
          </span>
        )}

        <label className="inline-flex items-center gap-1 text-xs text-stone-500">
          <input type="checkbox" checked={device.managed} disabled={!canManage}
            onChange={(e) => void update({ managed: e.target.checked })} />
          受管
        </label>

        <span className="text-xs text-stone-400 tabular-nums">
          {device.last_seen ? new Date(device.last_seen).toLocaleTimeString('zh-TW') : '從未連線'}
        </span>
      </span>
    </div>
  );
}
