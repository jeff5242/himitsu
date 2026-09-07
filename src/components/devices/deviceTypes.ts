export interface Device {
  id: string;
  org_id: string;
  device_id: string;
  label: string | null;
  user_id: string | null;
  managed: boolean;
  hostname: string | null;
  ip: string | null;
  version: string | null;
  event_id: string | null;
  pending_count: number;
  last_seen: string | null;
  created_at: string;
}

export const ONLINE_WINDOW_MS = 45_000;

export function isDeviceOnline(device: Device, now: number = Date.now()): boolean {
  if (!device.last_seen) return false;
  return now - new Date(device.last_seen).getTime() < ONLINE_WINDOW_MS;
}
