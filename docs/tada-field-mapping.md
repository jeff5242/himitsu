# TADA → HiMitsu 欄位對照表

> EPIC-0 §0-3 交付物：只做對照表、不做匯入程式——目的是確認 HiMitsu 模型「裝得下」TADA 舊資料。
> 實際搬遷是日後獨立任務（唯讀匯出 → 轉檔 → 寫入 himitsu schema），全程不動 TADA 舊庫。
> 標【待確認】者需屆時對照 TADA 實際欄位名核對；本表依大會實戰檢討的概念清單整理。

## 對照原則（實戰教訓 → 模型支柱）

| TADA 的痛 | HiMitsu 的制度化 |
|---|---|
| 一人身兼個人會員＋團體代表，報到/投票各算各的，現場靠人腦 | `persons`（自然人）與 `identities`（身分）分離：一人多身分，報到按人聚合、權利按身分各算 |
| can_vote 爭議三次收斂（76 票）——投票資格跟著即時會籍浮動 | `rosters`/`roster_entries` 屆次名冊快照：資格看「凍結那一刻」，凍結後 DB trigger 擋改 |
| 「誰改的」靠回憶對話 | `audit_log` 全表 trigger 自動 before/after |
| election id、密碼、桌數上限等寫死在程式 | `settings_catalog`＋`org_settings` 設定中心 |

## 會員主檔

| TADA（概念欄位） | HiMitsu | 備註 |
|---|---|---|
| 會員編號 | `memberships.member_no` | 快照另存 `roster_entries.member_no`（不隨主檔變動） |
| 姓名 | `persons.name` | 同名兩人靠不同 `person.id` 區分（手機輔助辨識） |
| 手機 | `persons.mobile` | |
| Email | `persons.email` | |
| 公司名稱 | `legal_entities.name` | 團體代表經 `identities.entity_id` 掛法人 |
| 統一編號【待確認】 | `legal_entities.tax_id` | |
| 職稱 | `identities.title` | |
| 會員類別（個人/團體/榮譽…） | `identities.kind` ＋ `memberships.member_type` | TADA 單欄位拆成「身分種類」與「會籍類型」兩層 |
| 會籍狀態（有效/退會…） | `memberships.status` | 狀態機轉移表驅動，終態（榮譽/永久/除籍）DB 層保護 |
| 入會日期【待確認】 | `memberships.joined_at` | |
| 備註 | `persons.note` / `identities.note` / `memberships.note` | 依語意拆層 |

## 大會功能（EPIC-1 再實作，模型已預留）

| TADA（概念欄位） | HiMitsu | 備註 |
|---|---|---|
| can_vote 投票資格 | `roster_entries.rights`（jsonb，`{"can_vote": true}`） | **不再掛即時會籍**——掛凍結名冊 |
| 領票/報到紀錄 | EPIC-1 `checkin` 相關表（未建） | 功能開關已入冊：`features.checkin` |
| 桌次 | EPIC-1 宴會/桌次表（未建） | 桌數上限已入冊：`assembly.table_capacity`、`assembly.max_tables` |
| 投票紀錄（tada_vote_*） | EPIC-2 選務模組（未建） | 開關：`features.voting` |
| 繳費紀錄【待確認】 | EPIC-1 `fees` 相關表（未建） | 權限已預留：finance 角色 `fees.write`；費率已入冊 |

## 寫死常數 → 設定中心

| TADA 寫死項（概念） | `settings_catalog` key |
|---|---|
| 報到機管理密碼 | `assembly.kiosk_pin` |
| 報到歡迎詞/頁面文案 | `assembly.welcome_message`、`text.*` |
| 桌數上限/每桌人數 | `assembly.max_tables`、`assembly.table_capacity` |
| 會費金額 | `fees.*`（個人/團體年費、入會費） |
| 任期/席次/除籍年限 | `charter.*` |
| election id【待確認】 | EPIC-2 選務模組的 event 主檔（不進 settings） |

## 帳號

| TADA | HiMitsu | 備註 |
|---|---|---|
| 管理端登入（單一密碼/帳號）【待確認】 | Supabase Auth（magic link＋密碼）＋ `org_users.role` 七角色 | 邀請制入職，權限查 `role_permissions` |

## 匯入時的資料轉換要點（日後匯入器的規格草稿）

1. **先建 persons 再建 identities**：TADA 一列「會員」若同人多筆（個人＋代表），須以姓名＋手機歸戶成一個 person、多個 identity——歸戶規則需人工複核清單
2. **會籍狀態對映表**：TADA 狀態值 →`memberships.status` 的對照需屆時逐值確認（特別是隱藏籍/停權類）
3. **歷屆名冊**：TADA 的 can_vote 快照（若有留存）轉成 `rosters`（每屆一份）＋`roster_entries`，匯入後立即凍結
4. 匯入全程走 service role 直寫 himitsu schema，**只讀** TADA 匯出檔（CSV/JSON），不連 TADA 舊庫
