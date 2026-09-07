// 本地代理（kiosk-agent.py）的前端客戶端——/kiosk 頁專用。
// 由 agent 服務時（port 8080）走同源；開發時（vite 5173）打 127.0.0.1:8080。
import type { Attendee } from './types';

const BASE = window.location.port === '8080' ? '' : 'http://127.0.0.1:8080';

export interface AgentStatus {
  ready: boolean;
  online: boolean;
  managed: boolean;
  pending: number;
  event: { id: string; name: string; status: string } | null;
  device_id: string;
  version: string;
}

export interface AgentData {
  attendees: (Attendee & { _local?: boolean; _queued?: boolean })[];
  items: { key: string; label: string; sort: number }[];
  pickups: [string, string][];
  require_paid: boolean;
  unpaid_memberships: string[];
}

export interface AgentActionResult {
  ok: boolean;
  already?: boolean;
  queued?: boolean;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, init);
  if (!response.ok && response.status !== 200) {
    throw new Error(`agent ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchAgentStatus(): Promise<AgentStatus> {
  return request<AgentStatus>('/agent/status');
}

export function fetchAgentData(): Promise<AgentData> {
  return request<AgentData>('/agent/attendees');
}

export function agentCheckin(attendeeId: string, channel: string): Promise<AgentActionResult> {
  return request<AgentActionResult>('/agent/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendee_id: attendeeId, channel }),
  });
}

export function agentPickup(
  attendeeId: string,
  itemKey: string,
  undo: boolean,
): Promise<AgentActionResult> {
  return request<AgentActionResult>('/agent/pickup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendee_id: attendeeId, item_key: itemKey, undo }),
  });
}

export const AGENT_ERROR_LABELS: Record<string, string> = {
  not_found: '找不到這筆名單',
  removed: '此人已除名',
  event_not_open: '活動未開放報到',
  unpaid_locked: '未繳會費，領取鎖定',
  undo_requires_online: '此筆已同步，需連線才能撤銷',
};
