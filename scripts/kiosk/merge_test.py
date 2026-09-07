#!/usr/bin/env python3
# ============================================================================
# EPIC-2 AC-18 兩機 merge 驗收：同一台 Mac/Linux 起兩個 agent 實例對打。
# 前置：兩個資料目錄都已各自 register 過（後台產兩個註冊碼）。
# 用法：python3 merge_test.py --dir-a ~/.kiosk-a --dir-b ~/.kiosk-b
# 流程：兩實例 → 都斷網 → 同一人兩邊各報到＋發放 → A 先復線、B 後復線
#       → 驗證 server：有效報到 1 筆、發放聯集不重複、兩機佇列歸零。
# ============================================================================
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.join(HERE, "kiosk-agent.py")
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


def http_json(method, url, body=None, headers=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


class Instance:
    def __init__(self, data_dir, port):
        self.dir = os.path.expanduser(data_dir)
        self.port = port
        self.flag = os.path.join(tempfile.gettempdir(), "kiosk-offline-%d" % port)
        with open(os.path.join(self.dir, "config.json")) as f:
            self.config = json.load(f)
        self.proc = None

    def start(self):
        env = {**os.environ, "KIOSK_OFFLINE_FLAG": self.flag}
        self.proc = subprocess.Popen(
            [sys.executable, AGENT, "run", "--data-dir", self.dir, "--port", str(self.port)],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

    def stop(self):
        if self.proc:
            self.proc.terminate()

    def api(self, method, path, body=None):
        return http_json(method, "http://127.0.0.1:%d%s" % (self.port, path), body)

    def wait(self, predicate, seconds, label):
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                status = self.api("GET", "/agent/status")
                if predicate(status):
                    return status
            except Exception:
                pass
            time.sleep(2)
        raise TimeoutError(label)

    def offline(self, on):
        if on:
            open(self.flag, "w").close()
        elif os.path.exists(self.flag):
            os.remove(self.flag)


def server_query(config, path_query):
    # 用 A 機的 kiosk 帳號查 server（讀權限足夠）
    token = http_json("POST",
        config["supabase_url"] + "/auth/v1/token?grant_type=password",
        {"email": config["email"], "password": config["password"]},
        {"apikey": config["anon_key"]})["access_token"]
    return http_json("GET", config["supabase_url"] + "/rest/v1/" + path_query,
                     headers={"apikey": config["anon_key"],
                              "Authorization": "Bearer " + token,
                              "Accept-Profile": "himitsu"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir-a", required=True)
    parser.add_argument("--dir-b", required=True)
    parser.add_argument("--port-a", type=int, default=8081)
    parser.add_argument("--port-b", type=int, default=8082)
    args = parser.parse_args()

    a = Instance(args.dir_a, args.port_a)
    b = Instance(args.dir_b, args.port_b)
    try:
        a.offline(False); b.offline(False)
        a.start(); b.start()
        print("等待兩實例上線＋快照就緒（後台需已把兩台裝置綁定同一場活動）…")
        a.wait(lambda s: s["ready"] and s["online"], 90, "A 未就緒")
        b.wait(lambda s: s["ready"] and s["online"], 90, "B 未就緒")

        data = a.api("GET", "/agent/attendees")
        target = next((x for x in data["attendees"]
                       if not x.get("checked_in_at") and not x.get("removed_at")), None)
        if not target:
            print("名單上沒有未報到者可測——先在後台清一位或加名單"); sys.exit(1)
        item = data["items"][0]["key"] if data["items"] else None
        print("測試對象：#%s %s" % (target["seq_no"], target["id"][:8]))

        # 兩機都斷網 → 各自報到＋發放
        a.offline(True); b.offline(True)
        time.sleep(1)
        ra = a.api("POST", "/agent/checkin", {"attendee_id": target["id"], "channel": "kiosk"})
        rb = b.api("POST", "/agent/checkin", {"attendee_id": target["id"], "channel": "kiosk"})
        check("離線報到（兩機都成功入列）",
              ra.get("ok") and rb.get("ok") and ra.get("queued") and rb.get("queued"))
        if item:
            pa = a.api("POST", "/agent/pickup", {"attendee_id": target["id"], "item_key": item})
            pb = b.api("POST", "/agent/pickup", {"attendee_id": target["id"], "item_key": item})
            check("離線發放（兩機都成功入列）", pa.get("ok") and pb.get("ok"))

        # A 先復線
        a.offline(False)
        a.wait(lambda s: s["online"] and s["pending"] == 0, 60, "A 佇列未歸零")
        check("A 復線後佇列歸零", True)
        # B 後復線（它的那筆會撞上 already／409 → merge）
        b.offline(False)
        b.wait(lambda s: s["online"] and s["pending"] == 0, 60, "B 佇列未歸零")
        check("B 復線後佇列歸零（merge：先同步者贏）", True)

        logs = server_query(a.config,
            "checkin_log?select=id&attendee_id=eq.%s&undone_at=is.null" % target["id"])
        check("server 有效報到僅 1 筆", len(logs) == 1, "實際 %d 筆" % len(logs))
        if item:
            picks = server_query(a.config,
                "attendee_pickups?select=id&attendee_id=eq.%s&item_key=eq.%s&undone_at=is.null"
                % (target["id"], urllib.parse.quote(item)))
            check("server 發放為聯集不重複（1 筆）", len(picks) == 1, "實際 %d 筆" % len(picks))

        failed = [r for r in results if not r[1]]
        print("\n===== AC-18 結果：%s（%d/%d PASS）=====" %
              ("全數通過 ✅" if not failed else "有 FAIL ❌",
               len(results) - len(failed), len(results)))
        sys.exit(1 if failed else 0)
    finally:
        a.stop(); b.stop()
        a.offline(False); b.offline(False)


if __name__ == "__main__":
    main()
