import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseTablesPerRow } from '../lib/tableLayout';

/** 讀設定中心「桌次每排桌數」（assembly.tables_per_row）；0＝自動 */
export function useTablesPerRow(orgId: string | undefined): number {
  const [perRow, setPerRow] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    void supabase.rpc('get_setting', { p_org: orgId, p_key: 'assembly.tables_per_row' })
      .then(({ data }) => setPerRow(parseTablesPerRow(data)));
  }, [orgId]);
  return perRow;
}
