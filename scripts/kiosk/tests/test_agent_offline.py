"""報到機 agent 的離線關鍵邏輯測試（EPIC-2）。

只測「斷網時獨力運作」那一段——不碰網路、不需要 Supabase。
這些規則若錯，大會當天沒有人能補救，所以每一條都要有測試。
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

AGENT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "kiosk-agent.py")


def load_agent_module():
    """檔名含連字號無法直接 import，由路徑載入。"""
    spec = importlib.util.spec_from_file_location("kiosk_agent", AGENT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["kiosk_agent"] = module
    spec.loader.exec_module(module)
    return module


ka = load_agent_module()

CONFIG = {"supabase_url": "https://example.invalid", "anon_key": "k",
          "site_url": "https://example.invalid", "device_id": "test-machine",
          "org_id": "org-1", "email": "kiosk@test.local", "password": "x"}


def make_attendee(attendee_id, **overrides):
    attendee = {"id": attendee_id, "seq_no": 1, "category": "member",
                "checked_in_at": None, "removed_at": None, "table_no": None,
                "guest_name": None, "identities": None}
    attendee.update(overrides)
    return attendee


def member_identity(membership_id="m-1"):
    return {"id": "i-1", "kind": "individual_member", "title": None,
            "persons": {"id": "p-1", "name": "測試甲", "mobile": "0911"},
            "legal_entities": None,
            "memberships": [{"id": membership_id, "member_no": "M0001", "status": "active"}]}


class AgentTestCase(unittest.TestCase):
    """每個測試一個乾淨的暫存資料目錄。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = ka.Store(self.tmp.name)
        self.agent = ka.Agent(CONFIG, self.store)
        self.agent.online = False          # 全程離線，_try_flush 直接返回
        self.agent.event = {"id": "e-1", "name": "測試大會", "status": "open"}

    def seed(self, attendees, items=(), pickups=()):
        self.store.replace_snapshot(list(attendees), list(items), list(pickups))


class TestQueueDurability(AgentTestCase):
    """斷電重啟佇列不遺失——AC-15 的核心保證。"""

    def test_queue_survives_agent_restart(self):
        # Arrange：離線報到一筆
        self.seed([make_attendee("a-1")])
        self.agent.do_checkin("a-1", "kiosk")
        self.assertEqual(self.store.pending_count(), 1)

        # Act：模擬斷電——丟掉記憶體物件，用同一個資料目錄重開
        reopened_store = ka.Store(self.tmp.name)
        reopened_agent = ka.Agent(CONFIG, reopened_store)

        # Assert：佇列與本地已報到狀態都還在
        self.assertEqual(reopened_store.pending_count(), 1)
        self.assertTrue(reopened_store.is_checked("a-1"))
        queued_checkins, _ = reopened_store.queues()
        self.assertEqual(queued_checkins[0]["attendee_id"], "a-1")

    def test_pending_count_sums_checkins_and_pickups(self):
        self.seed([make_attendee("a-1"), make_attendee("a-2")],
                  items=[{"key": "badge", "label": "名牌", "sort": 0}])
        self.agent.do_checkin("a-1", "kiosk")
        self.agent.do_checkin("a-2", "kiosk")
        self.agent.do_pickup("a-1", "badge")

        self.assertEqual(self.store.pending_count(), 3)


class TestOfflineCheckinRules(AgentTestCase):
    """離線時本地重演 server 規則——與 DB trigger 必須同義。"""

    def test_second_checkin_is_idempotent_and_queues_once(self):
        self.seed([make_attendee("a-1")])

        first = self.agent.do_checkin("a-1", "kiosk")
        second = self.agent.do_checkin("a-1", "kiosk")

        self.assertFalse(first["already"])
        self.assertTrue(second["already"])
        self.assertEqual(self.store.pending_count(), 1)   # 不重複入列

    def test_rejects_checkin_for_removed_attendee(self):
        self.seed([make_attendee("a-1", removed_at="2026-09-01T00:00:00Z")])

        result = self.agent.do_checkin("a-1", "kiosk")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "removed")
        self.assertEqual(self.store.pending_count(), 0)

    def test_rejects_checkin_when_event_not_open(self):
        self.seed([make_attendee("a-1")])
        self.agent.event = {"id": "e-1", "name": "測試大會", "status": "draft"}

        result = self.agent.do_checkin("a-1", "kiosk")

        self.assertEqual(result["error"], "event_not_open")

    def test_rejects_checkin_for_unknown_attendee(self):
        result = self.agent.do_checkin("nobody", "kiosk")

        self.assertEqual(result["error"], "not_found")

    def test_attendee_already_checked_in_on_server_is_not_requeued(self):
        # Arrange：快照顯示 server 端已報到（另一台先完成）
        self.seed([make_attendee("a-1", checked_in_at="2026-09-01T10:00:00Z")])

        result = self.agent.do_checkin("a-1", "kiosk")

        self.assertTrue(result["already"])
        self.assertEqual(self.store.pending_count(), 0)


class TestOfflinePickupRules(AgentTestCase):
    ITEMS = [{"key": "ballot", "label": "選票", "sort": 0}]

    def test_duplicate_pickup_is_rejected_as_already_issued(self):
        self.seed([make_attendee("a-1")], items=self.ITEMS)

        first = self.agent.do_pickup("a-1", "ballot")
        second = self.agent.do_pickup("a-1", "ballot")

        self.assertFalse(first.get("already"))
        self.assertTrue(second["already"])
        self.assertEqual(self.store.pending_count(), 1)

    def test_pickup_locked_for_unpaid_member_when_require_paid_enabled(self):
        # Arrange：未繳會費 + 協會開啟「未繳鎖領取」
        self.seed([make_attendee("a-1", identities=member_identity("m-unpaid"))],
                  items=self.ITEMS)
        self.agent.require_paid = True
        self.agent.unpaid_memberships = {"m-unpaid"}

        result = self.agent.do_pickup("a-1", "ballot")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "unpaid_locked")

    def test_pickup_allowed_for_unpaid_member_when_require_paid_disabled(self):
        self.seed([make_attendee("a-1", identities=member_identity("m-unpaid"))],
                  items=self.ITEMS)
        self.agent.require_paid = False
        self.agent.unpaid_memberships = {"m-unpaid"}

        result = self.agent.do_pickup("a-1", "ballot")

        self.assertTrue(result["ok"])

    def test_guest_pickup_is_never_blocked_by_fee_rules(self):
        # 來賓沒有會籍——不該被會費規則擋住
        self.seed([make_attendee("g-1", category="guest", guest_name="王來賓")],
                  items=self.ITEMS)
        self.agent.require_paid = True
        self.agent.unpaid_memberships = {"m-unpaid"}

        result = self.agent.do_pickup("g-1", "ballot")

        self.assertTrue(result["ok"])

    def test_undo_removes_locally_queued_pickup(self):
        self.seed([make_attendee("a-1")], items=self.ITEMS)
        self.agent.do_pickup("a-1", "ballot")

        result = self.agent.do_pickup("a-1", "ballot", undo=True)

        self.assertTrue(result["ok"])
        self.assertFalse(self.store.has_pickup("a-1", "ballot"))
        self.assertEqual(self.store.pending_count(), 0)

    def test_undo_of_already_synced_pickup_requires_online(self):
        # Arrange：快照帶來的發放（已在 server 上），本機佇列沒有它
        self.seed([make_attendee("a-1")], items=self.ITEMS,
                  pickups=[{"attendee_id": "a-1", "item_key": "ballot"}])

        result = self.agent.do_pickup("a-1", "ballot", undo=True)

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "undo_requires_online")


class TestSnapshotReconciliation(AgentTestCase):
    """快照以 server 為準——避免本地 overlay 永久蓋住真實狀態。"""

    def test_snapshot_clears_overlay_once_server_confirms_checkin(self):
        # Arrange：離線報到 → overlay 記著
        self.seed([make_attendee("a-1")])
        self.agent.do_checkin("a-1", "kiosk")
        self.store.dequeue_checkin("a-1")          # 模擬回放成功

        # Act：新快照顯示 server 已收到這筆
        self.seed([make_attendee("a-1", checked_in_at="2026-09-01T10:00:00Z")])

        # Assert：overlay 已清，狀態改由快照提供
        rows, _, _ = self.store.attendees_with_overlay()
        self.assertEqual(rows[0]["checked_in_at"], "2026-09-01T10:00:00Z")
        self.assertNotIn("_local", rows[0])

    def test_overlay_marks_local_and_queued_rows_for_ui(self):
        self.seed([make_attendee("a-1")])
        self.agent.do_checkin("a-1", "kiosk")

        rows, _, _ = self.store.attendees_with_overlay()

        self.assertTrue(rows[0]["_local"])         # 本機報到
        self.assertTrue(rows[0]["_queued"])        # 待同步（UI 顯示 ⏳）

    def test_snapshot_replaces_rather_than_appends(self):
        self.seed([make_attendee("a-1"), make_attendee("a-2")])
        self.seed([make_attendee("a-3")])

        rows, _, _ = self.store.attendees_with_overlay()

        self.assertEqual([r["id"] for r in rows], ["a-3"])


class TestSslContext(unittest.TestCase):
    def test_context_has_root_certificates_loaded(self):
        # macOS python.org 版曾因零根憑證導致所有 HTTPS 失敗——這裡守住那個回歸
        self.assertGreater(ka.SSL_CTX.cert_store_stats()["x509_ca"], 0)


if __name__ == "__main__":
    unittest.main()
