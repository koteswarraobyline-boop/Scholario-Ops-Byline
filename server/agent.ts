/**
 * Telemetry agent for Linux VPS nodes.
 * - Python 3 standard library only (present on Ubuntu/Debian/AlmaLinux images)
 * - Reads /proc for CPU, memory, load, network and uptime; df for disk; ps for top processes;
 *   systemctl for service states; journalctl for recent error logs.
 * - Authenticates with a per-server secret token.
 */
export const AGENT_VERSION = '3.2.0';

const AGENT_PY = String.raw`#!/usr/bin/env python3
import json, os, re, shutil, socket, subprocess, sys, time, urllib.request, urllib.error

AGENT_VERSION = "__VERSION__"
CONF = "/etc/scholario-agent.conf"

def load_conf():
    conf = {}
    with open(CONF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                conf[k.strip()] = v.strip().strip('"')
    return conf

def read(path):
    with open(path) as f:
        return f.read()

def cpu_times():
    parts = read("/proc/stat").splitlines()[0].split()[1:]
    vals = [int(x) for x in parts]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return idle, sum(vals)

def net_bytes():
    rx = tx = 0
    for line in read("/proc/net/dev").splitlines()[2:]:
        name, data = line.split(":", 1)
        if name.strip() == "lo":
            continue
        cols = data.split()
        rx += int(cols[0]); tx += int(cols[8])
    return rx, tx

def mem():
    info = {}
    for line in read("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        info[k] = int(v.split()[0])
    total = info.get("MemTotal", 1)
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    return {"total": total // 1024, "used": (total - avail) // 1024, "avail": avail // 1024,
            "pct": round((total - avail) * 100.0 / total, 1)}

def disk():
    du = shutil.disk_usage("/")
    return {"total": round(du.total / 1e9, 1), "used": round(du.used / 1e9, 1), "free": round(du.free / 1e9, 1),
            "pct": round(du.used * 100.0 / du.total, 1)}

def os_name():
    try:
        for line in read("/etc/os-release").splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except Exception:
        pass
    return sys.platform

def run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""

def processes():
    out = run(["ps", "-eo", "pid,user,pcpu,rss,stat,comm", "--sort=-pcpu", "--no-headers"])
    procs = []
    for line in out.splitlines()[:15]:
        p = line.split(None, 5)
        if len(p) < 6:
            continue
        st = "sleeping" if p[4].startswith("S") or p[4].startswith("I") else ("stopped" if p[4].startswith("T") else "running")
        procs.append({"pid": int(p[0]), "user": p[1], "cpu": float(p[2]), "memMb": int(p[3]) // 1024, "status": st, "name": p[5]})
    return procs

def services(names):
    result = []
    for name in names:
        out = run(["systemctl", "show", name, "--no-pager", "-p", "ActiveState,MainPID,MemoryCurrent,ActiveEnterTimestamp,LoadState"])
        props = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        if props.get("LoadState") == "not-found":
            continue
        state = props.get("ActiveState", "inactive")
        state = {"activating": "restarting", "deactivating": "restarting", "reloading": "restarting"}.get(state, state)
        if state not in ("active", "inactive", "failed", "restarting"):
            state = "inactive"
        mem_raw = props.get("MemoryCurrent", "")
        mem_mb = int(mem_raw) // 1048576 if mem_raw.isdigit() else 0
        result.append({"name": name, "status": state, "pid": int(props.get("MainPID", "0") or 0), "memoryMb": mem_mb, "since": props.get("ActiveEnterTimestamp", "")})
    return result

# ── Optional database probe (only when DB_ENGINE is set in the agent config) ──
# Credentials never go into this file or the config: MySQL/MariaDB read them from DB_CNF
# (a [client] option file, chmod 600); PostgreSQL uses ~/.pgpass or PGPASSFILE.
def _cmd(args, env=None, timeout=10):
    t0 = time.time()
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or "command failed").strip()[:300])
    return p.stdout.strip(), round((time.time() - t0) * 1000)

def db_probe(conf):
    engine = conf.get("DB_ENGINE", "").strip().lower()
    if engine not in ("mysql", "mariadb", "postgresql"):
        return None
    name = conf.get("DB_NAME") or None
    rep = {"engine": engine, "name": name, "available": False, "latencyMs": None, "version": None, "sizeBytes": None,
           "connections": None, "maxConnections": None, "longRunningQueries": None, "replication": None, "error": None}
    try:
        if engine in ("mysql", "mariadb"):
            base = [shutil.which("mysql") or "mysql", "--defaults-extra-file=" + conf.get("DB_CNF", "/etc/scholario-agent-db.cnf"), "-N", "-B"]
            if conf.get("DB_HOST"): base += ["-h", conf["DB_HOST"]]
            if conf.get("DB_PORT"): base += ["-P", conf["DB_PORT"]]
            q = lambda sql: _cmd(base + ["-e", sql])[0]
            _, rep["latencyMs"] = _cmd(base + ["-e", "SELECT 1"])
            rep["available"] = True
            rep["version"] = q("SELECT VERSION()")
            rep["connections"] = int(q("SHOW GLOBAL STATUS LIKE 'Threads_connected'").split()[-1])
            rep["maxConnections"] = int(q("SHOW VARIABLES LIKE 'max_connections'").split()[-1])
            rep["longRunningQueries"] = int(q("SELECT COUNT(*) FROM information_schema.processlist WHERE command NOT IN ('Sleep','Daemon','Binlog Dump','Binlog Dump GTID') AND time > 60") or 0)
            if name:
                size = q("SELECT COALESCE(SUM(data_length + index_length),0) FROM information_schema.tables WHERE table_schema = '%s'" % name.replace("'", ""))
                rep["sizeBytes"] = int(float(size or 0))
            status = ""
            for stmt in ("SHOW REPLICA STATUS\\G", "SHOW SLAVE STATUS\\G"):
                try:
                    status = _cmd(base[:-2] + ["-e", stmt.replace("\\\\", "\\")])[0]
                    break
                except Exception:
                    continue
            if status:
                kv = dict((l.split(":", 1)[0].strip(), l.split(":", 1)[1].strip()) for l in status.splitlines() if ":" in l)
                io = kv.get("Replica_IO_Running", kv.get("Slave_IO_Running", ""))
                sqlr = kv.get("Replica_SQL_Running", kv.get("Slave_SQL_Running", ""))
                lag = kv.get("Seconds_Behind_Source", kv.get("Seconds_Behind_Master", ""))
                err = kv.get("Last_Error") or kv.get("Last_IO_Error") or kv.get("Last_SQL_Error") or None
                rep["replication"] = {"role": "replica", "state": "running" if io == "Yes" and sqlr == "Yes" else ("error" if err else "stopped"),
                                      "lagSec": int(lag) if lag.isdigit() else None, "lastSuccessAt": None, "error": err}
        else:
            env = dict(os.environ)
            args = [shutil.which("psql") or "psql", "-X", "-A", "-t", "-w"]
            for k, flag in (("DB_HOST", "-h"), ("DB_PORT", "-p"), ("DB_USER", "-U"), ("DB_NAME", "-d")):
                if conf.get(k): args += [flag, conf[k]]
            if conf.get("DB_PGPASSFILE"): env["PGPASSFILE"] = conf["DB_PGPASSFILE"]
            q = lambda sql: _cmd(args + ["-c", sql], env)[0]
            _, rep["latencyMs"] = _cmd(args + ["-c", "SELECT 1"], env)
            rep["available"] = True
            rep["version"] = q("SHOW server_version")
            rep["sizeBytes"] = int(q("SELECT pg_database_size(current_database())") or 0)
            rep["connections"] = int(q("SELECT count(*) FROM pg_stat_activity") or 0)
            rep["maxConnections"] = int(q("SHOW max_connections") or 0)
            rep["longRunningQueries"] = int(q("SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '60 seconds'") or 0)
            if q("SELECT pg_is_in_recovery()") == "t":
                lag = q("SELECT COALESCE(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp())::int, -1)")
                last = q("SELECT COALESCE(to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '')")
                recv = q("SELECT COALESCE((SELECT status FROM pg_stat_wal_receiver LIMIT 1), '')")
                rep["replication"] = {"role": "replica", "state": "running" if recv == "streaming" else "stopped",
                                      "lagSec": int(lag) if lag.lstrip("-").isdigit() and int(lag) >= 0 else None, "lastSuccessAt": last or None, "error": None}
            else:
                n = int(q("SELECT count(*) FROM pg_stat_replication") or 0)
                if n > 0:
                    rep["replication"] = {"role": "primary", "state": "running", "lagSec": None, "lastSuccessAt": None, "error": None}
    except Exception as e:
        rep["error"] = str(e)[:300]
    return rep

LAST_LOG_CURSOR = None
def error_logs():
    global LAST_LOG_CURSOR
    if not shutil.which("journalctl"):
        return []
    cmd = ["journalctl", "-p", "warning", "-o", "json", "--no-pager", "-n", "20"]
    cmd += ["--after-cursor", LAST_LOG_CURSOR] if LAST_LOG_CURSOR else ["--since", "-2min"]
    logs = []
    for line in run(cmd).splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        LAST_LOG_CURSOR = e.get("__CURSOR", LAST_LOG_CURSOR)
        prio = int(e.get("PRIORITY", 6))
        msg = e.get("MESSAGE", "")
        if isinstance(msg, list):
            msg = bytes(msg).decode("utf-8", "replace")
        ts = int(e.get("__REALTIME_TIMESTAMP", "0")) / 1e6
        logs.append({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)), "level": "error" if prio <= 3 else "warn", "service": e.get("SYSLOG_IDENTIFIER", e.get("_COMM", "system")), "message": str(msg)[:1000]})
    return logs

def main():
    conf = load_conf()
    url = conf["SERVER_URL"].rstrip("/") + "/api/v1/agent/ingest"
    token = conf["AGENT_TOKEN"]
    interval = max(5, int(conf.get("INTERVAL_SEC", "10")))
    watch = [s for s in re.split(r"[,\s]+", conf.get("SERVICES", "")) if s]
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    idle0, total0 = cpu_times(); rx0, tx0 = net_bytes(); t0 = time.time()
    time.sleep(1)
    tick = 0
    while True:
        try:
            idle1, total1 = cpu_times(); rx1, tx1 = net_bytes(); t1 = time.time()
            dt_total = max(1, total1 - total0)
            cpu = round(100.0 * (1 - (idle1 - idle0) / dt_total), 1)
            secs = max(0.001, t1 - t0)
            net_in = round((rx1 - rx0) * 8 / 1000 / secs); net_out = round((tx1 - tx0) * 8 / 1000 / secs)
            idle0, total0, rx0, tx0, t0 = idle1, total1, rx1, tx1, t1
            m = mem(); d = disk()
            payload = {
                "agentVersion": AGENT_VERSION, "hostname": socket.gethostname(), "os": os_name(),
                "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "cpuCores": os.cpu_count(), "ramTotalMb": m["total"], "diskTotalGb": d["total"],
                "memTotalMb": m["total"], "memUsedMb": m["used"], "memAvailableMb": m["avail"],
                "diskUsedGb": d["used"], "diskFreeGb": d["free"],
                "uptimeSec": float(read("/proc/uptime").split()[0]),
                "cpuPercent": cpu, "ramPercent": m["pct"], "diskPercent": d["pct"],
                "agentStartedAt": started_at,
                "load": [float(x) for x in read("/proc/loadavg").split()[:3]],
                "netInKbps": net_in, "netOutKbps": net_out,
            }
            # Heavier collections every 3rd report
            if tick % 3 == 0:
                errors = []
                for key, fn in (("processes", processes), ("services", lambda: services(watch)), ("logs", error_logs)):
                    try:
                        payload[key] = fn()
                    except Exception as e:
                        errors.append("%s: %s" % (key, str(e)[:200]))
                try:
                    dbr = db_probe(conf)
                    if dbr is not None:
                        payload["databases"] = [dbr]
                        if dbr.get("error"): errors.append("database: " + dbr["error"])
                except Exception as e:
                    errors.append("database: %s" % str(e)[:200])
                payload["errors"] = errors
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "scholario-agent/" + AGENT_VERSION})
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            print("ingest rejected: HTTP %s %s" % (e.code, e.read()[:200]), file=sys.stderr, flush=True)
            if e.code == 401:
                time.sleep(60)
        except Exception as e:
            print("report failed: %s" % e, file=sys.stderr, flush=True)
        tick += 1
        time.sleep(interval)

if __name__ == "__main__":
    main()
`.replace('__VERSION__', AGENT_VERSION);

export function buildInstaller(opts: { serverUrl: string; agentToken: string; hostname: string; services: string }) {
  // Values are written into a quoted heredoc, so they must be single-line and shell-safe
  if (!/^https?:\/\/[^\s'"`$\\]+$/.test(opts.serverUrl)) throw new Error('Invalid server URL for agent installer');
  if (!/^[a-f0-9]{32,128}$/.test(opts.agentToken)) throw new Error('Invalid agent token');
  const services = opts.services.split(/[\s,]+/).filter(s => /^[\w@.\-]+$/.test(s)).join(' ');
  opts = { ...opts, services, hostname: opts.hostname.replace(/[^\w.\-]/g, '') };
  return `#!/usr/bin/env bash
# Scholario Ops telemetry agent installer — ${opts.hostname}
# Usage: curl -fsSL '<url>' | sudo bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found — installing"
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq python3;
  elif command -v dnf >/dev/null; then dnf install -y -q python3;
  elif command -v yum >/dev/null; then yum install -y -q python3;
  else echo "Install python3 manually and re-run." >&2; exit 1; fi
fi

install -d -m 0755 /opt/scholario-agent
cat > /opt/scholario-agent/agent.py <<'SCHOLARIO_AGENT_EOF'
${AGENT_PY}SCHOLARIO_AGENT_EOF
chmod 0755 /opt/scholario-agent/agent.py

umask 077
cat > /etc/scholario-agent.conf <<'EOF'
SERVER_URL=${opts.serverUrl}
AGENT_TOKEN=${opts.agentToken}
INTERVAL_SEC=10
# Space-separated systemd units to report (edit, then: systemctl restart scholario-agent)
SERVICES=${opts.services}
# Optional database probe (leave DB_ENGINE empty to disable). No passwords here:
#  mysql / mariadb: put [client] user=... password=... in DB_CNF (chmod 600)
#  postgresql:      use ~/.pgpass of root or set DB_PGPASSFILE
DB_ENGINE=
DB_NAME=
DB_HOST=
DB_PORT=
DB_USER=
DB_CNF=/etc/scholario-agent-db.cnf
DB_PGPASSFILE=
EOF
chmod 0600 /etc/scholario-agent.conf

cat > /etc/systemd/system/scholario-agent.service <<'EOF'
[Unit]
Description=Scholario Ops telemetry agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/env python3 /opt/scholario-agent/agent.py
Restart=always
RestartSec=10
Nice=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now scholario-agent
systemctl restart scholario-agent
sleep 3
systemctl --no-pager --lines=5 status scholario-agent || true
echo
echo "✔ Scholario agent installed. Logs: journalctl -u scholario-agent -f"
`;
}

export function buildUninstaller() {
  return `#!/usr/bin/env bash
set -euo pipefail
systemctl disable --now scholario-agent 2>/dev/null || true
rm -f /etc/systemd/system/scholario-agent.service /etc/scholario-agent.conf
rm -rf /opt/scholario-agent
systemctl daemon-reload
echo "Scholario agent removed."
`;
}
