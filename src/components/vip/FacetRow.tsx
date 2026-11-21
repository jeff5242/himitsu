import type { Facet } from '../../lib/vip';

interface FacetRowProps {
  label: string;
  facets: Facet[];
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}

/** 一列篩選膠囊：「全部」＋各分類（顯示 已報到／總數），可橫向捲動 */
export default function FacetRow({ label, facets, selected, onSelect }: FacetRowProps) {
  if (facets.length <= 1) return null;
  const pill = (isActive: boolean) =>
    `shrink-0 rounded-full border px-4 py-2 text-base whitespace-nowrap ${isActive
      ? 'border-amber-600 bg-amber-600 font-bold text-white'
      : 'border-stone-300 bg-white text-stone-700 hover:border-amber-500'}`;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <span className="shrink-0 w-12 text-sm font-bold text-stone-500">{label}</span>
      <button type="button" onClick={() => onSelect(undefined)} className={pill(selected === undefined)}>全部</button>
      {facets.map((f) => (
        <button key={f.key} type="button" onClick={() => onSelect(selected === f.key ? undefined : f.key)}
          className={pill(selected === f.key)}>
          {f.key}
          <span className="ml-1.5 text-sm tabular-nums opacity-80">{f.checkedIn}/{f.total}</span>
        </button>
      ))}
    </div>
  );
}
