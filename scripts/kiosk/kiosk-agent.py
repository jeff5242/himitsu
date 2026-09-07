#!/usr/bin/env python3
# ============================================================================
# HiMitsu 報到機本地代理（EPIC-2 L14）
# 純 Python 標準庫＋SQLite；樹莓派/任何 Linux/macOS 免安裝依賴。
#
# 用法：
#   註冊  python3 kiosk-agent.py register --supabase-url URL --anon-key KEY --code CODE
#   執行  python3 kiosk-agent.py run
#   （--data-dir 預設 ~/.himitsu-kiosk；--port 預設 8080；--site-url 預設正式站）
#
# 架構：瀏覽器只連 127.0.0.1:<port>；本代理維護名冊快照（SQLite）＋離線佇列，
#   每 10 秒同步迴圈：online 探測 → 心跳 → 佇列回放 → 快照/資產下載。
#   /tmp/kiosk-agent-offline 檔案存在＝強制離線（驗收 AC-15 用）。
# 衝突規則：server 端 check_in 冪等（先同步者贏）、領取 unique（union 不重複），
#   本代理只負責老實回放。
# ============================================================================
import argparse
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AGENT_VERSION = "1.0.0"
# 強制離線旗標檔；KIOSK_OFFLINE_FLAG 環境變數可覆寫（兩實例 merge 測試各自控制）
OFFLINE_FLAG = os.environ.get("KIOSK_OFFLINE_FLAG", "/tmp/kiosk-agent-offline")
SYNC_INTERVAL = 10          # 秒
SNAPSHOT_INTERVAL = 60      # 秒（managed 時）
PROBE_TIMEOUT = 4           # 秒
DEFAULT_SITE = "https://himitsu.milkidea.com"

ATTENDEE_SELECT = ("*,identities(id,kind,title,persons(id,name,mobile),"
                   "legal_entities(name),memberships(id,member_no,status))")


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ── 設定與資料庫 ─────────────────────────────────────────────────────────
class Store:
    def __init__(self, data_dir):
        self.dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        os.makedirs(os.path.join(data_dir, "webcache"), exist_ok=True)
        self.db_path = os.path.join(data_dir, "kiosk.db")
        self.lock = threading.RLock()
        with self._conn() as c:
            c.executescript("""
              CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
              CREATE TABLE IF NOT EXISTS attendees(id TEXT PRIMARY KEY, json TEXT);
              CREATE TABLE IF NOT EXISTS items(key TEXT PRIMARY KEY, json TEXT);
              CREATE TABLE IF NOT EXISTS pickups(attendee_id TEXT, item_key TEXT,
                PRIMARY KEY(attendee_id, item_key));
              CREATE TABLE IF NOT EXISTS overlay_checkin(attendee_id TEXT PRIMARY KEY, at TEXT);
              CREATE TABLE IF NOT EXISTS queue_checkin(attendee_id TEXT PRIMARY KEY,
                channel TEXT, queued_at TEXT);
              CREATE TABLE IF NOT EXISTS queue_pickup(attendee_id TEXT, item_key TEXT,
                queued_at TEXT, PRIMARY KEY(attendee_id, item_key));
            """)

    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def kv_get(self, key, default=None):
        with self.lock, self._conn() as c:
            row = c.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
            return json.loads(row["value"]) if row else default

    def kv_set(self, key, value):
        with self.lock, self._conn() as c:
            c.execute("INSERT INTO kv(key,value) VALUES(?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (key, json.dumps(value)))

    def replace_snapshot(self, attendees, items, pickups):
        with self.lock, self._conn() as c:
            c.execute("DELETE FROM attendees")
            c.executemany("INSERT INTO attendees(id,json) VALUES(?,?)",
                          [(a["id"], json.dumps(a)) for a in attendees])
            c.execute("DELETE FROM items")
            c.executemany("INSERT INTO items(key,json) VALUES(?,?)",
                          [(i["key"], json.dumps(i)) for i in items])
            c.execute("DELETE FROM pickups")
            c.executemany("INSERT OR IGNORE INTO pickups(attendee_id,item_key) VALUES(?,?)",
                          [(p["attendee_id"], p["item_key"]) for p in pickups])
            # server 已收到的報到 → 對應 overlay 可清（以 server 為準）
            checked = {a["id"] for a in attendees if a.get("checked_in_at")}
            for row in c.execute("SELECT attendee_id FROM overlay_checkin").fetchall():
                if row["attendee_id"] in checked:
                    c.execute("DELETE FROM overlay_checkin WHERE attendee_id=?",
                              (row["attendee_id"],))

    def attendees_with_overlay(self):
        with self.lock, self._conn() as c:
            rows = [json.loads(r["json"]) for r in c.execute("SELECT json FROM attendees")]
            overlay = {r["attendee_id"]: r["at"]
                       for r in c.execute("SELECT * FROM overlay_checkin")}
            queued = {r["attendee_id"] for r in c.execute("SELECT attendee_id FROM queue_checkin")}
            items = [json.loads(r["json"]) for r in
                     c.execute("SELECT json FROM items ORDER BY key")]
            pickups = [[r["attendee_id"], r["item_key"]]
                       for r in c.execute("SELECT * FROM pickups")]
        for a in rows:
            if not a.get("checked_in_at") and a["id"] in overlay:
                a["checked_in_at"] = overlay[a["id"]]
                a["_local"] = True
            if a["id"] in queued:
                a["_queued"] = True
        return rows, items, pickups

    def get_attendee(self, attendee_id):
        with self.lock, self._conn() as c:
            row = c.execute("SELECT json FROM attendees WHERE id=?", (attendee_id,)).fetchone()
            return json.loads(row["json"]) if row else None

    def local_checkin(self, attendee_id, channel):
        now = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
        with self.lock, self._conn() as c:
            c.execute("INSERT OR IGNORE INTO overlay_checkin(attendee_id,at) VALUES(?,?)",
                      (attendee_id, now))
            c.execute("INSERT OR IGNORE INTO queue_checkin(attendee_id,channel,queued_at) "
                      "VALUES(?,?,?)", (attendee_id, channel, now))

    def is_checked(self, attendee_id):
        a = self.get_attendee(attendee_id)
        if a and a.get("checked_in_at"):
            return True
        with self.lock, self._conn() as c:
            return c.execute("SELECT 1 FROM overlay_checkin WHERE attendee_id=?",
                             (attendee_id,)).fetchone() is not None

    def has_pickup(self, attendee_id, item_key):
        with self.lock, self._conn() as c:
            return c.execute("SELECT 1 FROM pickups WHERE attendee_id=? AND item_key=?",
                             (attendee_id, item_key)).fetchone() is not None

    def local_pickup(self, attendee_id, item_key):
        now = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
        with self.lock, self._conn() as c:
            c.execute("INSERT OR IGNORE INTO pickups(attendee_id,item_key) VALUES(?,?)",
                      (attendee_id, item_key))
            c.execute("INSERT OR IGNORE INTO queue_pickup(attendee_id,item_key,queued_at) "
                      "VALUES(?,?,?)", (attendee_id, item_key, now))

    def undo_local_pickup(self, attendee_id, item_key):
        """僅撤銷還在佇列中的本地發放；回傳是否成功"""
        with self.lock, self._conn() as c:
            cur = c.execute("DELETE FROM queue_pickup WHERE attendee_id=? AND item_key=?",
                            (attendee_id, item_key))
            if cur.rowcount:
                c.execute("DELETE FROM pickups WHERE attendee_id=? AND item_key=?",
                          (attendee_id, item_key))
                return True
            return False

    def remove_synced_pickup(self, attendee_id, item_key):
        with self.lock, self._conn() as c:
            c.execute("DELETE FROM pickups WHERE attendee_id=? AND item_key=?",
                      (attendee_id, item_key))

    def queues(self):
        with self.lock, self._conn() as c:
            checkins = [dict(r) for r in c.execute(
                "SELECT * FROM queue_checkin ORDER BY queued_at")]
            pickups = [dict(r) for r in c.execute(
                "SELECT * FROM queue_pickup ORDER BY queued_at")]
        return checkins, pickups

    def pending_count(self):
        with self.lock, self._conn() as c:
            a = c.execute("SELECT count(*) n FROM queue_checkin").fetchone()["n"]
            b = c.execute("SELECT count(*) n FROM queue_pickup").fetchone()["n"]
        return a + b

    def dequeue_checkin(self, attendee_id):
        with self.lock, self._conn() as c:
            c.execute("DELETE FROM queue_checkin WHERE attendee_id=?", (attendee_id,))

    def dequeue_pickup(self, attendee_id, item_key):
        with self.lock, self._conn() as c:
            c.execute("DELETE FROM queue_pickup WHERE attendee_id=? AND item_key=?",
                      (attendee_id, item_key))


# ── Supabase 客戶端（urllib）────────────────────────────────────────────
class Cloud:
    def __init__(self, config):
        self.cfg = config
        self.token = None
        self.token_exp = 0
        self.lock = threading.Lock()

    def _request(self, method, url, headers=None, body=None, timeout=15):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None

    def probe(self):
        try:
            req = urllib.request.Request(self.cfg["supabase_url"] + "/auth/v1/health",
                                         headers={"apikey": self.cfg["anon_key"]})
            urllib.request.urlopen(req, timeout=PROBE_TIMEOUT).read()
            return True
        except Exception:
            return False

    def login(self):
        status, data = self._request(
            "POST", self.cfg["supabase_url"] + "/auth/v1/token?grant_type=password",
            headers={"apikey": self.cfg["anon_key"], "Content-Type": "application/json"},
            body={"email": self.cfg["email"], "password": self.cfg["password"]})
        self.token = data["access_token"]
        self.token_exp = time.time() + int(data.get("expires_in", 3600)) - 120
        log("已登入（kiosk 帳號）")

    def _auth_headers(self, profile_header):
        with self.lock:
            if not self.token or time.time() > self.token_exp:
                self.login()
        return {"apikey": self.cfg["anon_key"],
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                profile_header: "himitsu"}

    def rpc(self, fn, params):
        url = self.cfg["supabase_url"] + "/rest/v1/rpc/" + fn
        try:
            _, data = self._request("POST", url,
                                    headers=self._auth_headers("Content-Profile"),
                                    body=params)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 401:           # token 失效 → 重登再試一次
                with self.lock:
                    self.login()
                _, data = self._request("POST", url,
                                        headers=self._auth_headers("Content-Profile"),
                                        body=params)
                return data
            raise

    def rest_get(self, path_query):
        url = self.cfg["supabase_url"] + "/rest/v1/" + path_query
        _, data = self._request("GET", url, headers=self._auth_headers("Accept-Profile"))
        return data

    def rest_post(self, table, body):
        url = self.cfg["supabase_url"] + "/rest/v1/" + table
        headers = self._auth_headers("Content-Profile")
        headers["Prefer"] = "return=minimal"
        return self._request("POST", url, headers=headers, body=body)

    def rest_patch(self, path_query, body):
        url = self.cfg["supabase_url"] + "/rest/v1/" + path_query
        headers = self._auth_headers("Content-Profile")
        headers["Prefer"] = "return=minimal"
        return self._request("PATCH", url, headers=headers, body=body)

    def fetch_raw(self, url, timeout=20):
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(), resp.headers.get("Content-Type", "")


# ── Agent 主體 ───────────────────────────────────────────────────────────
class Agent:
    def __init__(self, config, store):
        self.cfg = config
        self.store = store
        self.cloud = Cloud(config)
        self.online = False
        self.managed = True
        self.event = None            # {id, name, status}
        self.require_paid = False
        self.unpaid_memberships = set()
        self.last_snapshot = 0
        self.ready = False
        self.state_lock = threading.Lock()
        self._load_cached_state()

    def _load_cached_state(self):
        cached = self.store.kv_get("event")
        if cached:
            self.event = cached
            self.ready = self.store.kv_get("snapshot_at") is not None
        self.require_paid = bool(self.store.kv_get("require_paid", False))
        self.unpaid_memberships = set(self.store.kv_get("unpaid_memberships", []))

    # ── 同步迴圈 ──
    def sync_forever(self):
        while True:
            try:
                self.sync_once()
            except Exception as e:
                log("同步例外：%r" % e)
                self.online = False
            time.sleep(SYNC_INTERVAL)

    def sync_once(self):
        forced_offline = os.path.exists(OFFLINE_FLAG)
        self.online = (not forced_offline) and self.cloud.probe()
        if not self.online:
            if forced_offline:
                log("強制離線中（%s）｜待同步 %d" % (OFFLINE_FLAG, self.store.pending_count()))
            return

        hb = self.cloud.rpc("device_heartbeat", {
            "p_device_id": self.cfg["device_id"],
            "p_ip": local_ip(), "p_version": AGENT_VERSION,
            "p_pending": self.store.pending_count()})
        if not hb or not hb.get("ok"):
            log("心跳被拒：%s" % (hb or {}).get("error"))
            return
        self.managed = bool(hb.get("managed"))
        new_event_id = hb.get("event_id")
        with self.state_lock:
            old_id = (self.event or {}).get("id")
            if new_event_id != old_id:
                self.last_snapshot = 0   # 換場次 → 立刻重抓
            self.event = ({"id": new_event_id, "name": hb.get("event_name"),
                           "status": hb.get("event_status")} if new_event_id else None)
            self.store.kv_set("event", self.event)

        self.replay()

        if self.managed and self.event and \
           time.time() - self.last_snapshot > SNAPSHOT_INTERVAL:
            self.snapshot()

    def replay(self):
        checkins, pickups = self.store.queues()
        for q in checkins:
            r = self.cloud.rpc("check_in", {"p_attendee": q["attendee_id"],
                                            "p_channel": q["channel"]})
            if r and r.get("ok"):
                self.store.dequeue_checkin(q["attendee_id"])
                if r.get("already"):
                    log("回放：%s 另一台已先完成（merge：先同步者贏）" % q["attendee_id"][:8])
            elif r and r.get("error") in ("removed", "not_found", "event_not_open"):
                log("回放丟棄 %s：%s" % (q["attendee_id"][:8], r["error"]))
                self.store.dequeue_checkin(q["attendee_id"])
            else:
                return   # 網路/權限問題：保留，下輪再試
        for q in pickups:
            try:
                self.cloud.rest_post("attendee_pickups", {
                    "org_id": self.cfg["org_id"],
                    "event_id": (self.event or {}).get("id"),
                    "attendee_id": q["attendee_id"], "item_key": q["item_key"]})
                self.store.dequeue_pickup(q["attendee_id"], q["item_key"])
            except urllib.error.HTTPError as e:
                if e.code == 409:   # unique 防線＝另一台已發（union 不重複）
                    self.store.dequeue_pickup(q["attendee_id"], q["item_key"])
                    log("回放：%s/%s 另一台已發放" % (q["attendee_id"][:8], q["item_key"]))
                elif e.code in (400, 403, 422):
                    body = e.read().decode("utf-8", "replace")[:120]
                    log("回放發放被拒（保留人工處理）：%s" % body)
                    self.store.dequeue_pickup(q["attendee_id"], q["item_key"])
                else:
                    return

    def snapshot(self):
        event_id = self.event["id"]
        q = urllib.parse.quote
        attendees = self.cloud.rest_get(
            "event_attendees?select=%s&event_id=eq.%s&order=seq_no"
            % (q(ATTENDEE_SELECT), event_id))
        items = self.cloud.rest_get(
            "pickup_items?select=key,label,sort&event_id=eq.%s&order=sort" % event_id)
        pickups = self.cloud.rest_get(
            "attendee_pickups?select=attendee_id,item_key&event_id=eq.%s&undone_at=is.null"
            % event_id)
        require_paid = self.cloud.rpc("get_setting", {
            "p_org": self.cfg["org_id"], "p_key": "checkin.require_paid"}) is True
        unpaid = self.cloud.rest_get(
            "fee_invoices?select=membership_id,fee_periods!inner(status)"
            "&org_id=eq.%s&fee_periods.status=eq.open&status=in.(unpaid,reported)"
            % self.cfg["org_id"])
        self.store.replace_snapshot(attendees, items, pickups)
        self.require_paid = require_paid
        self.unpaid_memberships = {r["membership_id"] for r in (unpaid or [])}
        self.store.kv_set("require_paid", require_paid)
        self.store.kv_set("unpaid_memberships", sorted(self.unpaid_memberships))
        self.store.kv_set("snapshot_at", time.time())
        self.last_snapshot = time.time()
        self.ready = True
        self.cache_site_assets()
        log("快照完成：%d 人／%d 項目／%d 發放" % (len(attendees), len(items), len(pickups)))

    def cache_site_assets(self):
        """快取 SPA（index.html＋hash 資產）——會場零網路也能開站"""
        try:
            html, _ = self.cloud.fetch_raw(self.cfg["site_url"] + "/")
            cache_dir = os.path.join(self.store.dir, "webcache")
            with open(os.path.join(cache_dir, "index.html"), "wb") as f:
                f.write(html)
            for path in set(re.findall(rb'/assets/[A-Za-z0-9._-]+', html)):
                path = path.decode()
                target = os.path.join(cache_dir, path.lstrip("/").replace("/", os.sep))
                if os.path.exists(target):
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                data, _ = self.cloud.fetch_raw(self.cfg["site_url"] + path)
                with open(target, "wb") as f:
                    f.write(data)
                log("資產快取：%s" % path)
        except Exception as e:
            log("資產快取失敗（不影響報到）：%r" % e)

    # ── 本地報到規則（離線時與 DB trigger 同義重演）──
    def do_checkin(self, attendee_id, channel):
        a = self.store.get_attendee(attendee_id)
        if not a:
            return {"ok": False, "error": "not_found"}
        if a.get("removed_at"):
            return {"ok": False, "error": "removed"}
        if (self.event or {}).get("status") != "open":
            return {"ok": False, "error": "event_not_open"}
        if self.store.is_checked(attendee_id):
            return {"ok": True, "already": True}
        self.store.local_checkin(attendee_id, channel)
        threading.Thread(target=self._try_flush, daemon=True).start()
        return {"ok": True, "already": False, "queued": True}

    def do_pickup(self, attendee_id, item_key, undo=False):
        a = self.store.get_attendee(attendee_id)
        if not a:
            return {"ok": False, "error": "not_found"}
        if undo:
            if self.store.undo_local_pickup(attendee_id, item_key):
                return {"ok": True}
            if self.online:
                try:
                    self.cloud.rest_patch(
                        "attendee_pickups?attendee_id=eq.%s&item_key=eq.%s&undone_at=is.null"
                        % (attendee_id, item_key),
                        {"undone_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00")})
                    self.store.remove_synced_pickup(attendee_id, item_key)
                    return {"ok": True}
                except Exception as e:
                    return {"ok": False, "error": "undo_failed:%r" % e}
            return {"ok": False, "error": "undo_requires_online"}
        if a.get("removed_at"):
            return {"ok": False, "error": "removed"}
        if (self.event or {}).get("status") != "open":
            return {"ok": False, "error": "event_not_open"}
        if self.store.has_pickup(attendee_id, item_key):
            return {"ok": True, "already": True}
        if self.require_paid and a.get("identities"):
            member_ids = {m["id"] for m in a["identities"].get("memberships", [])}
            if member_ids & self.unpaid_memberships:
                return {"ok": False, "error": "unpaid_locked"}
        self.store.local_pickup(attendee_id, item_key)
        threading.Thread(target=self._try_flush, daemon=True).start()
        return {"ok": True, "already": False, "queued": True}

    def _try_flush(self):
        if self.online:
            try:
                self.replay()
            except Exception as e:
                log("即時回放失敗（留佇列）：%r" % e)

    def status(self):
        return {"ready": self.ready, "online": self.online, "managed": self.managed,
                "pending": self.store.pending_count(), "event": self.event,
                "device_id": self.cfg["device_id"], "org_id": self.cfg["org_id"],
                "version": AGENT_VERSION}


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ── 本地 HTTP 服務 ───────────────────────────────────────────────────────
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
        ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
        ".woff2": "font/woff2"}


def make_handler(agent):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, body, content_type="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send(204, b"", "text/plain")

        def do_GET(self):
            path = urllib.parse.urlparse(self.path).path
            if path == "/agent/status":
                return self._send(200, agent.status())
            if path == "/agent/attendees":
                attendees, items, pickups = agent.store.attendees_with_overlay()
                return self._send(200, {"attendees": attendees, "items": items,
                                        "pickups": pickups,
                                        "require_paid": agent.require_paid,
                                        "unpaid_memberships": sorted(agent.unpaid_memberships)})
            # 靜態資產（SPA 快取）
            rel = "index.html" if path in ("/", "") or not path.startswith("/assets/") \
                  else path.lstrip("/")
            target = os.path.join(agent.store.dir, "webcache", rel.replace("/", os.sep))
            if os.path.exists(target):
                ext = os.path.splitext(target)[1]
                with open(target, "rb") as f:
                    return self._send(200, f.read(), MIME.get(ext, "application/octet-stream"))
            return self._send(503, {"error": "asset_not_cached",
                                    "hint": "agent 尚未完成資產快取（需先連線一次）"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except Exception:
                return self._send(400, {"ok": False, "error": "bad_json"})
            path = urllib.parse.urlparse(self.path).path
            if path == "/agent/checkin":
                return self._send(200, agent.do_checkin(
                    body.get("attendee_id", ""), body.get("channel", "kiosk")))
            if path == "/agent/pickup":
                return self._send(200, agent.do_pickup(
                    body.get("attendee_id", ""), body.get("item_key", ""),
                    bool(body.get("undo"))))
            return self._send(404, {"ok": False, "error": "not_found"})
    return Handler


# ── 指令 ─────────────────────────────────────────────────────────────────
def cmd_register(args):
    hostname = socket.gethostname().split(".")[0]
    mac = "%012x" % uuid.getnode()
    payload = {"p_code": args.code, "p_hostname": hostname, "p_mac": mac}
    req = urllib.request.Request(
        args.supabase_url + "/rest/v1/rpc/register_device",
        data=json.dumps(payload).encode(), method="POST",
        headers={"apikey": args.anon_key, "Content-Type": "application/json",
                 "Content-Profile": "himitsu"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    if not result.get("ok"):
        print("註冊失敗：%s" % result.get("error"))
        sys.exit(1)
    config = {"supabase_url": args.supabase_url, "anon_key": args.anon_key,
              "site_url": args.site_url, "port": args.port,
              "device_id": result["device_id"], "org_id": result["org_id"],
              "email": result["email"], "password": result["password"]}
    os.makedirs(args.data_dir, exist_ok=True)
    cfg_path = os.path.join(args.data_dir, "config.json")
    with open(cfg_path, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(cfg_path, 0o600)
    print("✓ 註冊成功：%s（設定存於 %s）" % (result["device_id"], cfg_path))
    print("  下一步：python3 kiosk-agent.py run --data-dir %s" % args.data_dir)


def cmd_run(args):
    cfg_path = os.path.join(args.data_dir, "config.json")
    if not os.path.exists(cfg_path):
        print("找不到 %s——請先執行 register" % cfg_path)
        sys.exit(1)
    with open(cfg_path) as f:
        config = json.load(f)
    store = Store(args.data_dir)
    agent = Agent(config, store)
    threading.Thread(target=agent.sync_forever, daemon=True).start()
    port = int(config.get("port", args.port))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(agent))
    log("HiMitsu kiosk-agent v%s｜http://127.0.0.1:%d｜裝置 %s"
        % (AGENT_VERSION, port, config["device_id"]))
    log("報到台：http://127.0.0.1:%d/kiosk｜強制離線：touch %s" % (port, OFFLINE_FLAG))
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description="HiMitsu 報到機本地代理")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/.himitsu-kiosk"))
    sub = parser.add_subparsers(dest="cmd")
    reg = sub.add_parser("register")
    reg.add_argument("--supabase-url", required=True)
    reg.add_argument("--anon-key", required=True)
    reg.add_argument("--code", required=True)
    reg.add_argument("--site-url", default=DEFAULT_SITE)
    reg.add_argument("--port", type=int, default=8080)
    reg.add_argument("--data-dir", default=os.path.expanduser("~/.himitsu-kiosk"))
    run = sub.add_parser("run")
    run.add_argument("--port", type=int, default=8080)
    run.add_argument("--data-dir", default=os.path.expanduser("~/.himitsu-kiosk"))
    args = parser.parse_args()
    if args.cmd == "register":
        cmd_register(args)
    else:
        cmd_run(args if args.cmd == "run" else
                argparse.Namespace(data_dir=args.data_dir, port=8080))


if __name__ == "__main__":
    main()
