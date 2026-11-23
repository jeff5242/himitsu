import { Link } from 'react-router-dom';

interface FeatureOffNoticeProps {
  orgSlug: string;
  featureLabel: string;
}

/** 功能開關關閉時，直接輸入網址進來看到的說明 */
export default function FeatureOffNotice({ orgSlug, featureLabel }: FeatureOffNoticeProps) {
  return (
    <p className="rounded bg-stone-100 border border-stone-200 text-stone-600 text-sm px-3 py-4">
      這個協會已關閉「{featureLabel}」功能，資料仍然保留。負責人或秘書長可以到
      <Link to={`/o/${orgSlug}/settings`} className="mx-1 font-bold underline">設定</Link>
      的「功能開關」重新開啟。
    </p>
  );
}
