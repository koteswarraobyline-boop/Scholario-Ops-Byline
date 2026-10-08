# Exercises the agent 3.3 collectors with simulated /proc, systemctl, ss, chrony and pm2 output,
# plus real loopback HTTP checks. Nothing here reads the host or talks to real infrastructure.
import importlib.util, sys, json, threading, http.server, socket, collections
spec = importlib.util.spec_from_file_location("agent", sys.argv[1])
agent = importlib.util.module_from_spec(spec); spec.loader.exec_module(agent)
ok = lambda cond, msg: (_ for _ in ()).throw(AssertionError(msg)) if not cond else None

# ── 1. CPU: busy, iowait, steal from two /proc/stat samples ──
a = agent.parse_cpu("cpu  1000 0 500 8000 100 0 0 50 0 0\nbtime 1700000000\n")
b = agent.parse_cpu("cpu  1300 0 600 8400 200 0 0 100 0 0\nbtime 1700000000\n")
busy, iowait, steal = agent.cpu_percentages(a, b)  # dt = 300+100+400+100+50 = 950
ok((busy, iowait, steal) == (47.4, 10.5, 5.3), "cpu %s %s %s" % (busy, iowait, steal))
ok(agent.cpu_percentages(a, a) == (None, None, None), "no elapsed time → None, not 0")
ok(agent.parse_btime("cpu 1 2 3 4\nbtime 1700000000\n") == 1700000000, "btime")

# ── 2/3. Memory + swap ──
mi = agent.parse_meminfo("MemTotal: 8000000 kB\nMemFree: 500000 kB\nMemAvailable: 6000000 kB\nSwapTotal: 2097152 kB\nSwapFree: 1048576 kB\n")
m = agent.mem(mi)
ok(m["pct"] == 25.0 and m["avail"] == 5859, "memory uses MemAvailable, not MemFree: %s" % m)
ok(m["swapTotal"] == 2048 and m["swapUsed"] == 1024 and m["swapPct"] == 50.0, "swap %s" % m)
m0 = agent.mem(agent.parse_meminfo("MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n"))
ok(m0["swapTotal"] == 0 and m0["swapPct"] is None, "no swap configured → percent None")
ok(agent.parse_psi("some avg10=0.10 avg60=2.50 avg300=1.00 total=1\nfull avg10=0 avg60=1.25 avg300=0 total=1") == {"some": 2.5, "full": 1.25}, "psi")

# ── 4/5. Filesystems + inodes (virtual filesystems skipped, bind mounts de-duplicated) ──
MOUNTS = """/dev/vda1 / ext4 rw 0 0
proc /proc proc rw 0 0
tmpfs /run tmpfs rw 0 0
overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0
/dev/vdb1 /var/lib/mysql xfs rw 0 0
/dev/vda1 /srv/bind ext4 rw 0 0
/dev/vdc1 /data btrfs rw 0 0
server:/export /mnt/nfs nfs4 rw 0 0
/dev/loop0 /snap/core/1 squashfs ro 0 0
"""
SV = collections.namedtuple("SV", "f_blocks f_frsize f_bfree f_bavail f_files f_ffree")
fake = {"/": SV(1000000, 4096, 250000, 200000, 655360, 600000), "/var/lib/mysql": SV(500000, 4096, 25000, 25000, 100000, 1000), "/data": SV(100000, 4096, 50000, 50000, 0, 0)}
fss = agent.filesystems(MOUNTS, statvfs=lambda p: fake[p])
ok([f["mountPoint"] for f in fss] == ["/", "/var/lib/mysql", "/data"], "mounts %s" % [f["mountPoint"] for f in fss])
root = fss[0]
ok(root["usedPercent"] == 78.9 and root["totalGb"] == 4.1 and root["inodePercent"] == 8.4, "root fs %s" % root)
ok(fss[1]["usedPercent"] == 95.0 and fss[1]["inodePercent"] == 99.0, "mysql fs %s" % fss[1])
ok(fss[2]["inodeTotal"] is None and fss[2]["inodePercent"] is None, "btrfs has no inode table → None")

# ── 6. Disk I/O deltas (partitions / loop / dm skipped) ──
DS1 = "   8       0 sda 100 0 2000 50 200 0 4000 400 0 1000 450\n   8       1 sda1 100 0 2000 50 200 0 4000 400 0 1000 450\n 253 0 dm-0 1 0 1 1 1 0 1 1 0 1 1\n   7 0 loop0 1 0 1 1 1 0 1 1 0 1 1\n"
DS2 = "   8       0 sda 200 0 4048 150 300 0 8096 900 0 6000 1050\n   8       1 sda1 200 0 4048 150 300 0 8096 900 0 6000 1050\n 253 0 dm-0 1 0 1 1 1 0 1 1 0 1 1\n   7 0 loop0 1 0 1 1 1 0 1 1 0 1 1\n"
isd = lambda n: n == "sda"
io = agent.disk_io(agent.parse_diskstats(DS1, isd), agent.parse_diskstats(DS2, isd), 10.0)
ok(len(io) == 1 and io[0]["device"] == "sda", "only whole physical disks: %s" % io)
d = io[0]
ok(d["readBytesPerSec"] == 104858 and d["writeBytesPerSec"] == 209715, "throughput %s" % d)
ok(d["readOpsPerSec"] == 10.0 and d["writeOpsPerSec"] == 10.0 and d["ioUtilizationPercent"] == 50.0, "iops/util %s" % d)
ok(d["readLatencyMs"] == 1.0 and d["writeLatencyMs"] == 5.0, "latency %s" % d)
ok(agent.disk_io(agent.parse_diskstats(DS2, isd), agent.parse_diskstats(DS1, isd), 10.0) == [], "counter reset → no made-up rates")

# ── 7. Network per interface ──
NET1 = "Inter-|   Receive\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n    lo: 999 9 0 0 0 0 0 0 999 9 0 0 0 0 0 0\n  eth0: 1000 10 1 2 0 0 0 0 2000 20 0 3 0 0 0 0\n"
NET2 = "Inter-|   Receive\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n    lo: 9999 99 0 0 0 0 0 0 9999 99 0 0 0 0 0 0\n  eth0: 11000 110 1 4 0 0 0 0 7000 70 0 3 0 0 0 0\n"
n1, n2 = agent.parse_netdev(NET1), agent.parse_netdev(NET2)
ok(agent.net_totals(n2) == (11000, 7000), "totals exclude loopback")
ifs = agent.interfaces(n1, n2, 10.0, state=lambda n: "up", virtual=lambda n: False)
ok(len(ifs) == 1 and ifs[0]["name"] == "eth0", "loopback skipped")
e = ifs[0]
ok(e["rxBytesPerSec"] == 1000.0 and e["txBytesPerSec"] == 500.0 and e["rxPacketsPerSec"] == 10.0, "rates %s" % e)
ok(e["rxErrors"] == 1 and e["rxDrops"] == 4 and e["txDrops"] == 3 and e["operationalState"] == "up", "counters %s" % e)
ok(agent.interfaces({}, n2, 10.0, state=lambda n: None, virtual=lambda n: True)[0]["rxBytesPerSec"] is None, "first sample → None rate")

# ── 12. systemd parsing ──
svc = agent.parse_service("nginx", "ActiveState=failed\nSubState=failed\nMainPID=0\nMemoryCurrent=[not set]\nActiveEnterTimestamp=\nLoadState=loaded\nNRestarts=4\nResult=exit-code\n")
ok(svc["status"] == "failed" and svc["failed"] and svc["restartCount"] == 4 and svc["subState"] == "failed" and svc["memoryMb"] == 0, "service %s" % svc)
ok(agent.parse_service("ghost", "LoadState=not-found\nActiveState=inactive\n") is None, "missing unit skipped")
act = agent.parse_service("php8.3-fpm", "ActiveState=activating\nSubState=auto-restart\nMainPID=12\nMemoryCurrent=104857600\nLoadState=loaded\nNRestarts=\n")
ok(act["status"] == "restarting" and act["activeState"] == "activating" and act["restartCount"] is None and act["memoryMb"] == 100, "activating %s" % act)
fu = agent.parse_failed_units("● certbot.service loaded failed failed Certbot\nsnapd.service loaded failed failed Snap\n")
ok(fu == {"count": 2, "units": ["certbot.service", "snapd.service"]}, "failed units %s" % fu)
ok(agent.parse_failed_units("") == {"count": 0, "units": []}, "no failed units")

# ── listening ports ──
SS = 'LISTEN 0 511 127.0.0.1:4100 0.0.0.0:* users:(("node",pid=1234,fd=20))\nLISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=6),("nginx",pid=2,fd=6))\nLISTEN 0 4096 [::]:22 [::]:* users:(("sshd",pid=9,fd=4))\nLISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*\n'
ports = agent.parse_ss(SS)
ok([(p["address"], p["port"], p["scope"]) for p in ports] == [("127.0.0.1", 4100, "loopback"), ("0.0.0.0", 80, "all"), ("::", 22, "all"), ("127.0.0.53", 53, "loopback")], "ports %s" % ports)
ok(ports[1]["pids"] == [1, 2] and ports[1]["process"] == "nginx" and ports[3]["process"] is None, "ss pids/process")

# ── 8/9. PM2 allow-listing and secret filtering ──
SECRETS = ["sk_live_TOPSECRET", "hunter2-db-password", "eyJhbGciOi.jwt.secret", "AKIA-CLOUD-KEY"]
jlist = [{
    "pid": 1234, "name": "scholario-ops", "pm_id": 0,
    "monit": {"memory": 188743680, "cpu": 4.2},
    "pm2_env": {
        "status": "online", "pm_uptime": 1700000000000, "restart_time": 3, "unstable_restarts": 0,
        "node_version": "22.11.0", "exec_interpreter": "/usr/bin/node", "exec_mode": "fork_mode", "instances": 1,
        "version": "1.0.0", "pm_exec_path": "/var/www/scholario-ops-releases/20261008-101500-abc1234/dist-server/server.js",
        "versioning": {"revision": "abc1234def5678", "url": "https://user:" + SECRETS[3] + "@git.example/repo"},
        "env": {"STRIPE_KEY": SECRETS[0], "DATABASE_URL": "postgres://u:" + SECRETS[1] + "@db/app"},
        "JWT_SECRET": SECRETS[2], "DB_PASSWORD": SECRETS[1], "args": ["--token", SECRETS[0]],
        "pm_cwd": "/var/www/scholario-ops", "pm_out_log_path": "/root/.pm2/logs/out.log",
    },
}, {
    "pid": 0, "name": "worker", "pm_id": 1, "monit": {"memory": 0, "cpu": 0},
    "pm2_env": {"status": "errored", "pm_uptime": 1700000000000, "restart_time": 15, "exec_mode": "cluster_mode", "instances": "max", "version": "N/A", "env": {"API_KEY": SECRETS[3]}},
}]
raw = "[PM2] In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update\n" + json.dumps(jlist)
apps = agent.parse_pm2(raw, now=1700000100.0)
blob = json.dumps(apps)
for s in SECRETS:
    ok(s not in blob, "secret leaked into PM2 telemetry: " + s)
for forbidden in ("env", "args", "pm_cwd", "pm_out_log_path", "pm_exec_path", "versioning", "url"):
    ok(all(forbidden not in a for a in apps), "non-allow-listed key present: " + forbidden)
ALLOWED = {"id", "name", "status", "pid", "cpuPercent", "memoryMb", "uptimeSec", "startedAt", "restartCount", "unstableRestarts", "nodeVersion", "interpreter", "execMode", "instances", "version", "release", "gitRevision"}
ok(all(set(a.keys()) == ALLOWED for a in apps), "exact allow-list: %s" % [sorted(a.keys()) for a in apps])
s0, s1 = apps
ok(s0["status"] == "online" and s0["memoryMb"] == 180.0 and s0["cpuPercent"] == 4.2 and s0["uptimeSec"] == 100 and s0["restartCount"] == 3, "pm2 app %s" % s0)
ok(s0["nodeVersion"] == "22.11.0" and s0["interpreter"] == "node" and s0["execMode"] == "fork" and s0["release"] == "20261008-101500-abc1234" and s0["gitRevision"] == "abc1234def56", "pm2 runtime %s" % s0)
ok(s1["status"] == "errored" and s1["pid"] is None and s1["uptimeSec"] is None and s1["instances"] is None and s1["version"] is None and s1["execMode"] == "cluster", "errored app %s" % s1)
try:
    agent.parse_pm2('[{"name": "x", "pm2_env": {"env": {"K": "' + SECRETS[0] + '"}}')  # truncated JSON
    ok(False, "invalid JSON must raise")
except ValueError as err:
    ok(SECRETS[0] not in str(err), "parse error must not echo the output")
ok(agent.pm2_homes({"PM2_HOME": "/nonexistent/.pm2"}) == [], "no daemon → pm2 jlist is never run")

# ── 13. NTP parsing ──
ok(agent.parse_chrony_tracking("A9FEA9FE,169.254.169.254,3,1700000000.1,-0.000123456,0.000001,0.00002,-12.345,0.001,0.02,0.0004,0.0002,64.5,Normal") == (-0.123, -12.345), "chrony")
ok(agent.parse_chrony_tracking("garbage") == (None, None), "chrony garbage → None")
ok(agent.parse_timesync_offset("       Server: 1.2.3.4\n       Offset: -1.234ms\n") == -1.234, "timesyncd ms")
ok(agent.parse_timesync_offset("Offset: +52us") == 0.052, "timesyncd us")
ok(agent.parse_timesync_offset("Offset: +1.5s") == 1500.0, "timesyncd s")
ok(agent.parse_timesync_offset("no offset here") is None, "no offset → None")

# ── 10/11. Application port + local health checks (real loopback servers) ──
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code = {"/health": 200, "/broken": 500, "/moved": 302}.get(self.path, 404)
        self.send_response(code)
        if code == 302: self.send_header("Location", "http://example.invalid/")
        self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
good = agent.local_health({"applicationId": "app-1", "name": "Ops", "environment": "PRD", "port": port, "path": "/health"})
ok(good["status"] == "HEALTHY" and good["listening"] and good["statusCode"] == 200 and good["latencyMs"] is not None and good["environment"] == "PRD", "healthy %s" % good)
bad = agent.local_health({"port": port, "path": "/broken"})
ok(bad["status"] == "DOWN" and bad["statusCode"] == 500 and bad["error"] == "HTTP 500", "500 %s" % bad)
moved = agent.local_health({"port": port, "path": "/moved"})
ok(moved["statusCode"] == 302 and moved["status"] == "HEALTHY", "redirect is not followed off-host %s" % moved)
s = socket.socket(); s.bind(("127.0.0.1", 0)); closed = s.getsockname()[1]; s.close()
down = agent.local_health({"port": closed, "path": "/"})
ok(down["listening"] is False and down["status"] == "DOWN" and down["statusCode"] is None, "closed port %s" % down)
for unsafe in ({"port": port, "path": "@evil.example/"}, {"port": port, "path": "/x y"}, {"port": 0, "path": "/"}, {"port": "80", "path": "/"}, {"port": True, "path": "/"}):
    ok(agent.local_health(unsafe) is None, "unsafe target accepted: %s" % unsafe)
srv.shutdown()

print("ALL AGENT TELEMETRY CHECKS PASSED")
