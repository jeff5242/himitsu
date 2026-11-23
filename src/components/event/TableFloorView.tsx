import { useMemo } from 'react';
import { attendeeName } from '../../lib/attendee';
import { seatsOf, seatsUsed } from '../../lib/seats';
import { tableGridStyle } from '../../lib/tableLayout';
import type { Attendee } from '../../lib/types';
import type { EventTable } from './TablesTab';

interface TableFloorViewProps {
  /** 每排幾桌；0 或省略＝依寬度自動 */
  perRow?: number;
  tables: EventTable[];
  byTable: ReadonlyMap<number, Attendee[]>;
  /** 深色（投影頁用） */
  isDark?: boolean;
  /** 搜尋字串：含符合者的桌加金色光圈 */
  query?: string;
  onSelect?: (tableNo: number) => void;
}

const SEAT_RADIUS_PERCENT = 44;

/** 宴會廳平面圖：圓桌＋環狀座位點——綠＝已報到、實灰＝入座未報到、空心＝空位 */
export default function TableFloorView({ tables, byTable, isDark, query, onSelect, perRow = 0 }: TableFloorViewProps) {
  const keyword = (query ?? '').trim();

  const seatDots = useMemo(() => {
    const dots = new Map<number, { angleDeg: number; attendee: Attendee | null }[]>();
    for (const table of tables) {
      const seated = byTable.get(table.table_no) ?? [];
      // 每位來賓佔 1＋攜伴 個點（攜伴點沿用本人的報到狀態）
      const occupants = seated.flatMap((a) => Array.from({ length: seatsOf(a) }, () => a));
      const seats = Math.max(table.capacity, occupants.length);
      dots.set(table.table_no, Array.from({ length: seats }, (_, i) => ({
        angleDeg: (360 / seats) * i - 90,
        attendee: occupants[i] ?? null,
      })));
    }
    return dots;
  }, [tables, byTable]);

  return (
    <div className="overflow-x-auto"><div className="grid gap-6" style={tableGridStyle(perRow, perRow > 0 ? 130 : 170)}>
      {tables.map((table) => {
        const seated = byTable.get(table.table_no) ?? [];
        const used = seatsUsed(seated);
        const isFull = used >= table.capacity;
        const checkedIn = seated.filter((a) => a.checked_in_at).length;
        const isHit = keyword !== '' && seated.some((a) => attendeeName(a).includes(keyword));
        return (
          <button
            key={table.table_no}
            onClick={() => onSelect?.(table.table_no)}
            className="relative mx-auto block"
            style={{ width: 160, height: 160 }}
            title={seated.map((a) => attendeeName(a)).join('、') || '（空桌）'}
          >
            <span
              className={`absolute inset-4 rounded-full border-4 flex flex-col items-center justify-center ${
                isDark ? 'bg-stone-800' : 'bg-white shadow'
              } ${isHit ? 'ring-4 ring-amber-400' : ''} ${
                isFull ? 'border-red-400' : isDark ? 'border-stone-600' : 'border-green-500'
              }`}
            >
              <span className={`font-black text-lg ${isDark ? 'text-amber-400' : ''}`}>桌 {table.table_no}</span>
              {table.label && (
                <span className={`text-xs px-1 text-center leading-tight ${isDark ? 'text-stone-300' : 'text-amber-700'}`}>
                  {table.label}
                </span>
              )}
              <span className={`text-xs tabular-nums ${isDark ? 'text-stone-400' : 'text-stone-500'}`}>
                報到 {checkedIn}｜{used}／{table.capacity}
              </span>
            </span>
            {(seatDots.get(table.table_no) ?? []).map((seat, index) => {
              const radian = (seat.angleDeg * Math.PI) / 180;
              const left = 50 + SEAT_RADIUS_PERCENT * Math.cos(radian);
              const top = 50 + SEAT_RADIUS_PERCENT * Math.sin(radian);
              const state = seat.attendee
                ? seat.attendee.checked_in_at ? 'checked' : 'seated'
                : 'empty';
              return (
                <span
                  key={index}
                  title={seat.attendee ? attendeeName(seat.attendee) : '空位'}
                  className={`absolute h-3.5 w-3.5 rounded-full border-2 -translate-x-1/2 -translate-y-1/2 ${
                    state === 'checked' ? 'bg-green-500 border-green-600'
                    : state === 'seated' ? (isDark ? 'bg-stone-500 border-stone-400' : 'bg-stone-400 border-stone-500')
                    : (isDark ? 'bg-stone-900 border-stone-600' : 'bg-white border-stone-300')
                  }`}
                  style={{ left: `${left}%`, top: `${top}%` }}
                />
              );
            })}
          </button>
        );
      })}
    </div></div>
  );
}
