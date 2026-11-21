#!/usr/bin/env python3
"""把來賓 Excel／CSV 轉成一次性匯入 SQL（貼 Supabase SQL Editor 執行）。

欄位規則與前端「CSV 匯入來賓」相同（src/lib/guestCsv.ts）：
  姓名（必填）、單位、身分（例：貴賓／農民）、桌號；第一列必須是欄位名稱。
寫入走 himitsu.import_guests_core：整批原子（一筆失敗全部回滾）、
同姓名＋同單位已在名單者略過、桌號不存在自動建桌、爆桌整批拒絕。

用法：
  python3 scripts/guests-to-sql.py 名單.xlsx --org-slug miwu --event "2026 忘年會" > import.sql
  python3 scripts/guests-to-sql.py 名單.csv  --org-slug miwu --event "2026 忘年會" --sheet 工作表1
前置：SQL Editor 已執行 migration 20261120000011_guest_import.sql；協會與活動已建立。
"""
import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

Guest = Dict[str, object]
RowError = Tuple[int, str]

HEADER_ALIASES = {
    "name": ["姓名", "name"],
    "org": ["單位", "公司", "單位名稱", "org", "company"],
    "tag": ["身分", "身份", "類別", "tag"],
    "table_no": ["桌號", "桌次", "桌", "table"],
}
MAX_LEN = {"name": 50, "org": 100, "tag": 20}
LABELS = {"name": "姓名", "org": "單位", "tag": "身分"}
TABLE_NO_PATTERN = re.compile(r"^第?\s*(\d{1,3})\s*桌?$")
SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
DOLLAR_TAG = "$guests$"


def read_rows(path: Path, sheet: Optional[str]) -> List[List[str]]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl  # 只有 Excel 才需要
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        worksheet = workbook[sheet] if sheet else workbook.worksheets[0]
        return [["" if v is None else str(v) for v in row] for row in worksheet.iter_rows(values_only=True)]
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("big5")
    return list(csv.reader(io.StringIO(text)))


def normalize_cell(value: str) -> str:
    text = value.strip()
    return text[:-2] if re.fullmatch(r"\d+\.0", text) else text  # Excel 數字桌號 3 → "3.0"


def parse(rows: List[List[str]]) -> Tuple[List[Guest], List[RowError]]:
    if not rows:
        return [], [(1, "檔案是空的")]
    header = [h.strip().lower() for h in rows[0]]
    mapping = {}
    for field, aliases in HEADER_ALIASES.items():
        for index, h in enumerate(header):
            if h in aliases:
                mapping[field] = index
                break
    if "name" not in mapping:
        return [], [(1, "找不到「姓名」欄，第一列必須是欄位名稱")]

    guests, errors, seen = [], [], {}
    for offset, cells in enumerate(rows[1:]):
        line = offset + 2
        if all(normalize_cell(c) == "" for c in cells):
            continue

        def cell(field: str) -> str:
            index = mapping.get(field)
            return normalize_cell(cells[index]) if index is not None and index < len(cells) else ""

        values = {f: cell(f) for f in ("name", "org", "tag", "table_no")}
        if values["name"] == "":
            errors.append((line, "姓名空白"))
            continue
        too_long = [f for f in MAX_LEN if len(values[f]) > MAX_LEN[f]]
        if too_long:
            errors.append((line, f"{LABELS[too_long[0]]}超過 {MAX_LEN[too_long[0]]} 字"))
            continue
        table_no = None
        if values["table_no"]:
            match = TABLE_NO_PATTERN.match(values["table_no"])
            if not match or int(match.group(1)) <= 0:
                errors.append((line, f"桌號「{values['table_no']}」不是正整數"))
                continue
            table_no = int(match.group(1))
        key = (values["name"], values["org"])
        if key in seen:
            errors.append((line, f"與第 {seen[key]} 列重複（同姓名＋單位）"))
            continue
        seen[key] = line
        guests.append({"line": line, "name": values["name"], "org": values["org"] or None,
                       "tag": values["tag"] or None, "table_no": table_no})
    return guests, errors


def sql_literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def build_sql(guests: List[Guest], org_slug: str, event_name: str, source_name: str) -> str:
    payload = json.dumps(guests, ensure_ascii=False, indent=1)
    if DOLLAR_TAG in payload:
        raise ValueError("資料內含 $guests$ 字樣，無法安全引用")
    tags = {}
    for g in guests:
        tags[g["tag"] or "（未填）"] = tags.get(g["tag"] or "（未填）", 0) + 1
    tables = sorted({g["table_no"] for g in guests if g["table_no"] is not None})
    summary = "、".join(f"{k} {v}" for k, v in tags.items())
    return f"""-- ============================================================================
-- 來賓一次性匯入：{source_name}
-- 協會 slug：{org_slug}／活動：{event_name}
-- 共 {len(guests)} 筆（{summary}）；桌號：{', '.join(map(str, tables)) or '無'}
-- 結果：ok=true 表示成功，inserted＝新增、skipped＝已在名單略過、tables_created＝新建桌數；
--       ok=false 時名單沒有任何變動，看 detail 欄修正後重跑即可（重跑不會重複新增）。
-- 前置：已執行 migration 20261120000011_guest_import.sql
-- ============================================================================
SELECT himitsu.import_guests_core(
  (SELECT e.id FROM himitsu.events e
     JOIN himitsu.organizations o ON o.id = e.org_id
    WHERE o.slug = {sql_literal(org_slug)} AND e.name = {sql_literal(event_name)}),
  {DOLLAR_TAG}{payload}{DOLLAR_TAG}::jsonb
) AS result;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="來賓 Excel／CSV → 匯入 SQL")
    parser.add_argument("file", type=Path)
    parser.add_argument("--org-slug", required=True, help="協會英文代號（網址 /o/<slug>/ 那段）")
    parser.add_argument("--event", required=True, help="活動名稱（必須與系統上完全相同）")
    parser.add_argument("--sheet", help="Excel 工作表名稱（預設第一張）")
    args = parser.parse_args()

    if not SLUG_PATTERN.match(args.org_slug):
        print(f"協會代號格式不對：{args.org_slug}", file=sys.stderr)
        return 2
    guests, errors = parse(read_rows(args.file, args.sheet))
    if errors:
        print(f"有 {len(errors)} 列錯誤，未產生 SQL：", file=sys.stderr)
        for line, message in errors:
            print(f"  第 {line} 列：{message}", file=sys.stderr)
        return 1
    if not guests:
        print("沒有可匯入的資料", file=sys.stderr)
        return 1
    if len(guests) > 1000:
        print("超過 1000 筆，請分檔", file=sys.stderr)
        return 1
    sys.stdout.write(build_sql(guests, args.org_slug, args.event, args.file.name))
    print(f"OK：{len(guests)} 筆", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
