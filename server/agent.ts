/**
 * Telemetry agent for Linux VPS nodes.
 * - Python 3.7+ standard library only (present on Ubuntu/Debian/AlmaLinux images)
 * - READ-ONLY: it never restarts, stops, kills or reconfigures anything (services, PM2, databases,
 *   firewall). Every collector only reads /proc, /sys or the output of a read-only command.
 * - Every report (cheap /proc reads): CPU (+ iowait / steal), memory + swap, pressure (PSI), load,
 *   root disk, disk I/O, network (total + per interface), uptime.
 * - Every 3rd report: filesystems + inodes, top processes, systemd services + failed units,
 *   PM2 applications (allow-listed fields only — the raw `pm2 jlist` output, which contains every
 *   process environment, is never sent or logged), listening ports, local application health
 *   checks (127.0.0.1 only, targets supplied by the server), NTP state, journal warnings, database probe.
 * - Hourly: kernel, architecture, boot time, timezone, Node.js / npm versions.
 * - Authenticates with a per-server secret token.
 */
/** Single source of truth for the current agent version (the UI compares reported versions against it). */
export const AGENT_VERSION = '3.3.1';

const AGENT_PY = String.raw`#!/usr/bin/env python3
# Scholario Ops telemetry agent. READ-ONLY: never restarts, stops, kills or reconfigures anything.
import glob, json, os, re, shutil, socket, subprocess, sys, time, urllib.request, urllib.error

AGENT_VERSION = "__VERSION__"
CONF = "/etc/scholario-agent.conf"
HEAVY_BUDGET_SEC = 25

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

def read_opt(path):
    try:
        return read(path)
    except Exception:
        return None

def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))

def iso_ms(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + ".%03dZ" % int((ts % 1) * 1000)

def parse_kv(text):
    return dict(l.split("=", 1) for l in (text or "").splitlines() if "=" in l)

def run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""

def run_strict(cmd, timeout=5):
    """stdout, or None when the command is missing, times out or exits non-zero (never a guessed empty result)."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout if p.returncode == 0 else None
    except Exception:
        return None

# ── CPU ──────────────────────────────────────────────────────────────────────
CPU_FIELDS = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal")

def parse_cpu(stat_text):
    """Aggregate jiffies from the first line of /proc/stat (guest time is already counted in user)."""
    vals = [int(x) for x in stat_text.splitlines()[0].split()[1:9]]
    vals += [0] * (8 - len(vals))
    d = dict(zip(CPU_FIELDS, vals))
    d["idle_all"] = d["idle"] + d["iowait"]
    d["total"] = sum(vals)
    return d

def cpu_percentages(a, b):
    """(busy %, iowait %, steal %) between two parse_cpu() samples; Nones when no time passed."""
    dt = b["total"] - a["total"]
    if dt <= 0:
        return None, None, None
    pct = lambda x: round(min(100.0, max(0.0, 100.0 * x / dt)), 1)
    return pct(dt - (b["idle_all"] - a["idle_all"])), pct(b["iowait"] - a["iowait"]), pct(b["steal"] - a["steal"])

def parse_btime(stat_text):
    for line in stat_text.splitlines():
        if line.startswith("btime "):
            return int(line.split()[1])
    return None

def parse_psi(text):
    """/proc/pressure/<x>: 'some avg10=0.00 avg60=1.25 avg300=0.50 total=123' → {'some': 1.25, 'full': ...}"""
    out = {}
    for line in (text or "").splitlines():
        p = line.split()
        if p and p[0] in ("some", "full"):
            for kv in p[1:]:
                if kv.startswith("avg60="):
                    try:
                        out[p[0]] = float(kv[6:])
                    except ValueError:
                        pass
    return out

def pressure():
    """Pressure stall information (avg60 'some' %), None per resource when the kernel has no PSI."""
    res = {}
    for k in ("cpu", "memory", "io"):
        t = read_opt("/proc/pressure/" + k)
        res[k] = parse_psi(t).get("some") if t else None
    return res

# ── Memory + swap ────────────────────────────────────────────────────────────
def parse_meminfo(text):
    info = {}
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            try:
                info[k.strip()] = int(v.split()[0])
            except (ValueError, IndexError):
                pass
    return info

def mem(info=None):
    """Used = total - MemAvailable (page cache that can be reclaimed is not counted as used)."""
    info = info if info is not None else parse_meminfo(read("/proc/meminfo"))
    total = info.get("MemTotal") or 1
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    out = {"total": total // 1024, "used": (total - avail) // 1024, "avail": avail // 1024,
           "pct": round((total - avail) * 100.0 / total, 1)}
    st, sf = info.get("SwapTotal"), info.get("SwapFree")
    if st is None or sf is None:
        out.update(swapTotal=None, swapUsed=None, swapFree=None, swapPct=None)
    else:
        out.update(swapTotal=st // 1024, swapUsed=(st - sf) // 1024, swapFree=sf // 1024,
                   swapPct=round((st - sf) * 100.0 / st, 1) if st > 0 else None)
    return out

# ── Disk: root filesystem, all filesystems, I/O ──────────────────────────────
def disk():
    du = shutil.disk_usage("/")
    return {"total": round(du.total / 1e9, 1), "used": round(du.used / 1e9, 1), "free": round(du.free / 1e9, 1),
            "pct": round(du.used * 100.0 / du.total, 1)}

# Virtual, pseudo, read-only image and network filesystems are skipped (network mounts can hang statvfs).
SKIP_FS = set("autofs binfmt_misc bpf cgroup cgroup2 configfs debugfs devpts devtmpfs efivarfs fusectl hugetlbfs "
              "mqueue nsfs overlay proc pstore ramfs rpc_pipefs securityfs selinuxfs squashfs sysfs tmpfs tracefs "
              "nfs nfs4 cifs smb3 smbfs 9p iso9660 udf aufs ceph glusterfs".split())

def parse_mounts(text):
    """Real local filesystems from /proc/mounts, one entry per device (bind mounts dropped)."""
    seen, out = set(), []
    for line in text.splitlines():
        p = line.split()
        if len(p) < 3:
            continue
        dev, mnt, fs = p[0], p[1].replace("\\040", " "), p[2]
        if fs in SKIP_FS or fs.startswith("fuse") or mnt.startswith(("/proc", "/sys", "/dev", "/run", "/snap")) or dev in seen:
            continue
        seen.add(dev)
        out.append((dev, mnt, fs))
    return out[:30]

def filesystems(mounts_text=None, statvfs=None):
    statvfs = statvfs or os.statvfs  # resolved at call time: os.statvfs exists on Linux only
    out = []
    for dev, mnt, fs in parse_mounts(mounts_text if mounts_text is not None else read("/proc/mounts")):
        try:
            st = statvfs(mnt)
        except Exception:
            continue
        total = st.f_blocks * st.f_frsize
        if total <= 0:
            continue
        free = st.f_bavail * st.f_frsize
        used = (st.f_blocks - st.f_bfree) * st.f_frsize
        it, ifree = st.f_files, st.f_ffree
        out.append({"mountPoint": mnt, "filesystem": fs, "device": dev,
                    "totalGb": round(total / 1e9, 2), "usedGb": round(used / 1e9, 2), "freeGb": round(free / 1e9, 2),
                    "usedPercent": round(used * 100.0 / (used + free), 1) if used + free > 0 else None,
                    # Some filesystems (btrfs, vfat) have no fixed inode table: reported as None, not 0
                    "inodeTotal": it if it > 0 else None, "inodeUsed": it - ifree if it > 0 else None,
                    "inodeFree": ifree if it > 0 else None, "inodePercent": round((it - ifree) * 100.0 / it, 1) if it > 0 else None})
    return out

def is_physical_disk(name):
    return os.path.exists("/sys/block/%s/device" % name) and not name.startswith(("loop", "ram", "zram", "sr", "fd"))

def parse_diskstats(text, is_disk=is_physical_disk):
    """Whole-disk counters from /proc/diskstats (partitions, loop, device-mapper are skipped to avoid double counting)."""
    out = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) < 14 or not is_disk(p[2]):
            continue
        out[p[2]] = {"reads": int(p[3]), "rsect": int(p[5]), "rms": int(p[6]),
                     "writes": int(p[7]), "wsect": int(p[9]), "wms": int(p[10]), "ticks": int(p[12])}
    return out

def disk_io(a, b, secs):
    """Per-device rates between two parse_diskstats() samples (sectors are 512 bytes in /proc/diskstats)."""
    devs = []
    for name in sorted(b):
        x, y = a.get(name), b[name]
        if not x or secs <= 0:
            continue
        d = dict((k, y[k] - x[k]) for k in y)
        if any(v < 0 for v in d.values()):
            continue  # counters wrapped / device re-attached
        rio, wio = d["reads"], d["writes"]
        devs.append({"device": name,
                     "readBytesPerSec": round(d["rsect"] * 512 / secs), "writeBytesPerSec": round(d["wsect"] * 512 / secs),
                     "readOpsPerSec": round(rio / secs, 1), "writeOpsPerSec": round(wio / secs, 1),
                     "ioUtilizationPercent": round(min(100.0, d["ticks"] / (secs * 10.0)), 1),
                     "readLatencyMs": round(d["rms"] / float(rio), 2) if rio else None,
                     "writeLatencyMs": round(d["wms"] / float(wio), 2) if wio else None})
    return devs[:16]

# ── Network ──────────────────────────────────────────────────────────────────
def parse_netdev(text):
    out = {}
    for line in text.splitlines()[2:]:
        if ":" not in line:
            continue
        name, data = line.split(":", 1)
        c = data.split()
        if len(c) < 16:
            continue
        out[name.strip()] = {"rxB": int(c[0]), "rxP": int(c[1]), "rxE": int(c[2]), "rxD": int(c[3]),
                             "txB": int(c[8]), "txP": int(c[9]), "txE": int(c[10]), "txD": int(c[11])}
    return out

def net_totals(dev):
    """Aggregate bytes of every interface except loopback (unchanged since agent 3.0)."""
    rx = sum(v["rxB"] for k, v in dev.items() if k != "lo")
    tx = sum(v["txB"] for k, v in dev.items() if k != "lo")
    return rx, tx

def _operstate(name):
    return (read_opt("/sys/class/net/%s/operstate" % name) or "").strip() or None

def _is_virtual(name):
    return not os.path.exists("/sys/class/net/%s/device" % name)

def interfaces(a, b, secs, state=_operstate, virtual=_is_virtual):
    """Per-interface rates (bytes / packets per second) and cumulative error / drop counters. Loopback skipped."""
    out = []
    for name in sorted(b):
        if name == "lo":
            continue
        x, y = a.get(name), b[name]
        rate = lambda k: round(max(0, y[k] - x[k]) / secs, 1) if x and secs > 0 else None
        out.append({"name": name, "rxBytesPerSec": rate("rxB"), "txBytesPerSec": rate("txB"),
                    "rxPacketsPerSec": rate("rxP"), "txPacketsPerSec": rate("txP"),
                    "rxErrors": y["rxE"], "txErrors": y["txE"], "rxDrops": y["rxD"], "txDrops": y["txD"],
                    "operationalState": state(name), "virtual": virtual(name)})
    return out[:32]

# ── System information (hourly) ──────────────────────────────────────────────
def os_release(text=None):
    text = text if text is not None else (read_opt("/etc/os-release") or "")
    kv = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            kv[k.strip()] = v.strip().strip('"')
    return kv

def os_name():
    return os_release().get("PRETTY_NAME") or sys.platform

def timezone():
    tz = (read_opt("/etc/timezone") or "").strip()
    if tz:
        return tz
    try:
        link = os.readlink("/etc/localtime")
        if "zoneinfo/" in link:
            return link.split("zoneinfo/", 1)[1]
    except OSError:
        pass
    return run(["timedatectl", "show", "-p", "Timezone", "--value"]).strip() or time.tzname[0]

def version_of(cmd):
    exe = shutil.which(cmd)
    if not exe:
        return None
    m = re.search(r"v?(\d+\.\d+\.\d+)", run([exe, "--version"], timeout=15))
    return m.group(1) if m else None

def system_info():
    u = os.uname()
    osr = os_release()
    btime = parse_btime(read("/proc/stat"))
    return {"kernelVersion": u.release, "architecture": u.machine, "bootTime": iso(btime) if btime else None,
            "timezone": timezone(), "osName": osr.get("NAME"), "osVersion": osr.get("VERSION_ID") or osr.get("VERSION"),
            "nodeVersion": version_of("node"), "npmVersion": version_of("npm")}

# ── Time synchronisation ─────────────────────────────────────────────────────
TIME_SERVICES = ("chronyd", "chrony", "systemd-timesyncd", "ntpd", "ntp", "ntpsec")

def parse_chrony_tracking(csv_line):
    """chronyc -c tracking: field 4 = system time offset from NTP (s), field 7 = frequency error (ppm)."""
    p = (csv_line or "").strip().split(",")
    if len(p) < 8:
        return None, None
    try:
        return round(float(p[4]) * 1000, 3), round(float(p[7]), 3)
    except ValueError:
        return None, None

def parse_timesync_offset(text):
    """timedatectl timesync-status: 'Offset: -1.234ms' → -1.234"""
    m = re.search(r"Offset:\s*([+-]?[\d.]+)\s*(us|µs|μs|ms|s|min)\b", text or "")
    if not m:
        return None
    mult = {"us": 0.001, "µs": 0.001, "μs": 0.001, "ms": 1.0, "s": 1000.0, "min": 60000.0}[m.group(2)]
    return round(float(m.group(1)) * mult, 3)

def ntp_status():
    props = parse_kv(run_strict(["timedatectl", "show", "-p", "NTPSynchronized", "-p", "NTP"]))
    yn = {"yes": True, "no": False}
    service = None
    for name in TIME_SERVICES:
        if parse_kv(run(["systemctl", "show", name, "-p", "ActiveState"])).get("ActiveState") == "active":
            service = name
            break
    offset = drift = None
    if service in ("chronyd", "chrony") and shutil.which("chronyc"):
        offset, drift = parse_chrony_tracking(run(["chronyc", "-c", "tracking"]))
    elif service == "systemd-timesyncd":
        offset = parse_timesync_offset(run(["timedatectl", "timesync-status"]))
    return {"synchronized": yn.get(props.get("NTPSynchronized", "")), "ntpEnabled": yn.get(props.get("NTP", "")),
            "service": service, "clockOffsetMs": offset, "clockDriftPpm": drift}

# ── Processes / services ─────────────────────────────────────────────────────
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

def parse_service(name, text):
    """One 'systemctl show' result; None when the unit does not exist on this server."""
    props = parse_kv(text)
    if props.get("LoadState") == "not-found" or not props:
        return None
    raw = props.get("ActiveState", "inactive")
    state = {"activating": "restarting", "deactivating": "restarting", "reloading": "restarting"}.get(raw, raw)
    if state not in ("active", "inactive", "failed", "restarting"):
        state = "inactive"
    mem_raw = props.get("MemoryCurrent", "")
    nr = props.get("NRestarts", "")
    return {"name": name, "status": state, "activeState": raw, "subState": props.get("SubState") or None,
            "failed": raw == "failed", "restartCount": int(nr) if nr.isdigit() else None, "result": props.get("Result") or None,
            "pid": int(props.get("MainPID", "0") or 0), "memoryMb": int(mem_raw) // 1048576 if mem_raw.isdigit() else 0,
            "since": props.get("ActiveEnterTimestamp", "")}

def services(names):
    result = []
    for name in names:
        out = run(["systemctl", "show", name, "--no-pager", "-p",
                   "ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp,LoadState,NRestarts,Result"])
        svc = parse_service(name, out)
        if svc:
            result.append(svc)
    return result

def parse_failed_units(text):
    names = []
    for line in (text or "").splitlines():
        p = line.replace("●", " ").split()
        if p and p[0].endswith(".service"):
            names.append(p[0])
    return {"count": len(names), "units": names[:25]}

def failed_units():
    if not shutil.which("systemctl"):
        return None
    out = run_strict(["systemctl", "list-units", "--state=failed", "--type=service", "--no-legend", "--plain", "--no-pager"])
    return None if out is None else parse_failed_units(out)

# ── Listening ports ──────────────────────────────────────────────────────────
def parse_ss(text):
    """ss -Hltnp: 'LISTEN 0 511 127.0.0.1:4100 0.0.0.0:* users:(("node",pid=1234,fd=20))'"""
    seen, out = set(), []
    for line in (text or "").splitlines():
        p = line.split()
        if len(p) < 4 or p[0] == "State":
            continue
        host, _, port = p[3].rpartition(":")
        if not port.isdigit():
            continue
        host = host.strip("[]").split("%")[0]
        key = (host, int(port))
        if key in seen:
            continue
        seen.add(key)
        names = re.findall(r'\("([^"]+)",pid=', line)
        scope = "loopback" if host == "::1" or host.startswith("127.") else ("all" if host in ("0.0.0.0", "*", "::", "") else "address")
        out.append({"address": host or "*", "port": int(port), "process": names[0][:64] if names else None,
                    "pids": [int(x) for x in re.findall(r"pid=(\d+)", line)][:8], "scope": scope})
    return out[:100]

def listening_ports():
    if not shutil.which("ss"):
        return None
    out = run_strict(["ss", "-Hltnp"])
    return None if out is None else parse_ss(out)

# ── PM2 (allow-listed fields only) ───────────────────────────────────────────
PM2_STATUSES = ("online", "stopping", "stopped", "launching", "errored", "one-launch-status", "waiting restart")
RELEASE_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{7,40}$")

def release_id(exec_path):
    """Release directory (deploy/release.sh layout: <releases>/<YYYYMMDD-HHMMSS-sha>/...) of a script path."""
    if not exec_path:
        return None
    try:
        exec_path = os.path.realpath(exec_path)
    except Exception:
        pass
    for part in re.split(r"[\\/]", exec_path):
        if RELEASE_RE.match(part):
            return part
    return None

def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

def parse_pm2(text, now=None):
    """Builds NEW dicts from explicitly allow-listed fields of 'pm2 jlist'. Nothing else (env, args, paths) is copied."""
    # PM2 may print notices such as "[PM2] In-memory PM2 is out-of-date" before the JSON list
    m = re.search(r"(?m)^\[\s*[{\]]", text or "")
    if not m:
        raise ValueError("pm2 jlist returned no JSON list")
    try:
        data = json.loads(text[m.start():])
    except ValueError:
        raise ValueError("pm2 jlist output is not valid JSON")  # never echo the output: it contains process environments
    now = now if now is not None else time.time()
    apps = []
    for p in data if isinstance(data, list) else []:
        if not isinstance(p, dict):
            continue
        env = p.get("pm2_env") if isinstance(p.get("pm2_env"), dict) else {}
        monit = p.get("monit") if isinstance(p.get("monit"), dict) else {}
        status = env.get("status") if env.get("status") in PM2_STATUSES else "unknown"
        up = _num(env.get("pm_uptime"))
        mem_b = _num(monit.get("memory"))
        interp = env.get("exec_interpreter") if isinstance(env.get("exec_interpreter"), str) else None
        mode = env.get("exec_mode") if isinstance(env.get("exec_mode"), str) else None
        inst = env.get("instances")
        vers = env.get("versioning") if isinstance(env.get("versioning"), dict) else {}
        rev = vers.get("revision") if isinstance(vers.get("revision"), str) else ""
        ver = env.get("version") if isinstance(env.get("version"), str) else None
        node_v = env.get("node_version") if isinstance(env.get("node_version"), str) else None
        exec_path = env.get("pm_exec_path") if isinstance(env.get("pm_exec_path"), str) else ""
        apps.append({
            "id": p.get("pm_id") if isinstance(p.get("pm_id"), int) else None,
            "name": str(p.get("name", ""))[:100],
            "status": status,
            "pid": p.get("pid") if isinstance(p.get("pid"), int) and p.get("pid") > 0 else None,
            "cpuPercent": _num(monit.get("cpu")),
            "memoryMb": round(mem_b / 1048576.0, 1) if mem_b is not None else None,
            "uptimeSec": round(now - up / 1000.0) if status == "online" and up else None,
            "startedAt": iso(up / 1000.0) if up else None,
            "restartCount": env.get("restart_time") if isinstance(env.get("restart_time"), int) else None,
            "unstableRestarts": env.get("unstable_restarts") if isinstance(env.get("unstable_restarts"), int) else None,
            "nodeVersion": node_v[:32] if node_v else None,
            "interpreter": os.path.basename(interp)[:32] if interp else None,
            "execMode": mode.replace("_mode", "")[:16] if mode else None,
            "instances": inst if isinstance(inst, int) and not isinstance(inst, bool) else None,
            "version": ver[:40] if ver and ver != "N/A" else None,
            "release": release_id(exec_path),
            "gitRevision": rev[:12] if re.match(r"^[0-9a-f]{7,40}$", rev) else None,
        })
    return apps

def pm2_homes(conf):
    """PM2 homes with a RUNNING daemon. 'pm2 jlist' is never called without one (it would start a new daemon)."""
    cands = [h for h in re.split(r"[,\s]+", conf.get("PM2_HOME", "")) if h] or (["/root/.pm2"] + sorted(glob.glob("/home/*/.pm2")))
    live = []
    for h in cands:
        try:
            os.kill(int(read(os.path.join(h, "pm2.pid")).strip()), 0)
            live.append(h)
        except Exception:
            continue
    return live

def trusted_for(path, uid):
    """A binary may run for uid only if it (and its directory) is owned by root or by uid and is not
    writable by anyone else — a user's own pm2/node is never executed for root (or another user)."""
    try:
        for p in (os.path.realpath(path), os.path.dirname(os.path.realpath(path)), os.path.dirname(path)):
            st = os.stat(p)
            if st.st_uid not in (0, uid) or st.st_mode & 0o022:
                return False
        node = os.path.join(os.path.dirname(path), "node")  # nvm layout: node next to pm2, first on PATH
        return not os.path.exists(node) or trusted_for_file(node, uid)
    except OSError:
        return False

def trusted_for_file(path, uid):
    try:
        st = os.stat(os.path.realpath(path))
        return st.st_uid in (0, uid) and not st.st_mode & 0o022
    except OSError:
        return False

def find_pm2(conf, uid):
    cands = [conf["PM2_BIN"]] if conf.get("PM2_BIN") else []
    cands += [shutil.which("pm2") or "", "/usr/local/bin/pm2", "/usr/bin/pm2"]
    homes = ["/root"] if uid == 0 else [pwd_home(uid)]
    for h in filter(None, homes):
        cands += sorted(glob.glob(h + "/.nvm/versions/node/*/bin/pm2"), reverse=True)
    for c in cands:
        if c and os.access(c, os.X_OK) and trusted_for(c, uid):
            return c
    return None

def pwd_home(uid):
    try:
        import pwd
        return pwd.getpwuid(uid).pw_dir
    except Exception:
        return None

def pm2_processes(conf, listening=None):
    homes = pm2_homes(conf)
    if not homes:
        return None  # PM2 is not running on this server
    by_pid = {}
    for l in listening or []:
        for pid in l["pids"]:
            by_pid.setdefault(pid, set()).add(l["port"])
    apps = []
    for home in homes:
        st = os.stat(home)
        exe = find_pm2(conf, st.st_uid)
        if not exe:
            raise RuntimeError("a PM2 daemon is running in %s but no trusted pm2 command was found (owned by root or the daemon's user, not writable by others; set PM2_BIN in %s)" % (home, CONF))
        import pwd  # POSIX only; imported here so the parsers stay importable anywhere
        try:
            owner = pwd.getpwuid(st.st_uid).pw_name
        except KeyError:
            owner = str(st.st_uid)
        # Minimal environment; run as the daemon's owner so nothing in their PM2_HOME changes ownership
        env = {"PATH": os.path.dirname(exe) + ":/usr/local/bin:/usr/bin:/bin", "PM2_HOME": home, "HOME": os.path.dirname(home)}
        def demote(uid=st.st_uid, gid=st.st_gid):
            if os.getuid() == 0 and uid != 0:
                os.setgroups([])
                os.setgid(gid)
                os.setuid(uid)
        try:
            p = subprocess.run([exe, "jlist"], capture_output=True, text=True, timeout=20, env=env, preexec_fn=demote)
        except subprocess.TimeoutExpired:
            raise RuntimeError("pm2 jlist timed out (%s)" % home)
        if p.returncode != 0:
            raise RuntimeError("pm2 jlist failed with exit code %d (%s)" % (p.returncode, home))  # output never included
        for a in parse_pm2(p.stdout):
            a["owner"] = owner
            a["ports"] = sorted(by_pid.get(a["pid"], ())) if a["pid"] else []
            apps.append(a)
    return apps[:60]

# ── Local application health (targets come from the Scholario Ops server) ────
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._~\-/?=&%:+,]*$")

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

_LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)

def local_health(check, host="127.0.0.1", opener=None):
    """GET http://127.0.0.1:<port><path> — loopback only, no redirects, no proxy, at most 1 KB read."""
    port, path = check.get("port"), check.get("path") or "/"
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535 or not isinstance(path, str) or len(path) > 200 or not SAFE_PATH.match(path):
        return None
    res = {"applicationId": str(check.get("applicationId", ""))[:64], "name": str(check.get("name", ""))[:100],
           "environment": check.get("environment") if check.get("environment") in ("PRD", "DR") else None,
           "port": port, "path": path, "listening": None, "status": "UNKNOWN", "statusCode": None,
           "latencyMs": None, "error": None, "checkedAt": iso(time.time())}
    try:
        socket.create_connection((host, port), timeout=3).close()
        res["listening"] = True
    except Exception:
        res.update(listening=False, status="DOWN", error="nothing accepting connections on %s:%d" % (host, port))
        return res
    t0 = time.time()
    try:
        req = urllib.request.Request("http://%s:%d%s" % (host, port, path), headers={"User-Agent": "scholario-agent/" + AGENT_VERSION})
        with (opener or _LOCAL_OPENER).open(req, timeout=5) as r:
            r.read(1024)
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        res.update(status="DOWN", latencyMs=round((time.time() - t0) * 1000, 1), error=(type(e).__name__ + ": " + str(e))[:200])
        return res
    res.update(latencyMs=round((time.time() - t0) * 1000, 1), statusCode=code, status="HEALTHY" if 200 <= code < 400 else "DOWN")
    if res["status"] == "DOWN":
        res["error"] = "HTTP %d" % code
    return res

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
                    # Vertical (\G) output needs the column names: drop -N / -B by value (not by position — host/port follow them)
                    status = _cmd([a for a in base if a not in ("-N", "-B")] + ["-e", stmt.replace("\\\\", "\\")])[0]
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
    started_at = iso(time.time())
    cpu0 = parse_cpu(read("/proc/stat")); net0 = parse_netdev(read("/proc/net/dev"))
    dsk0 = parse_diskstats(read_opt("/proc/diskstats") or ""); t0 = time.time()
    time.sleep(1)
    tick = 0
    sysinfo, sysinfo_at = None, 0
    app_checks = []
    last_rtt_ms = None
    while True:
        try:
            cpu1 = parse_cpu(read("/proc/stat")); net1 = parse_netdev(read("/proc/net/dev"))
            dsk1 = parse_diskstats(read_opt("/proc/diskstats") or ""); t1 = time.time()
            secs = max(0.001, t1 - t0)
            cpu, iowait, steal = cpu_percentages(cpu0, cpu1)
            rx0, tx0 = net_totals(net0); rx1, tx1 = net_totals(net1)
            net_in = round(max(0, rx1 - rx0) * 8 / 1000 / secs); net_out = round(max(0, tx1 - tx0) * 8 / 1000 / secs)
            ifaces = interfaces(net0, net1, secs)
            dio = disk_io(dsk0, dsk1, secs)
            cpu0, net0, dsk0, t0 = cpu1, net1, dsk1, t1
            m = mem(); d = disk()
            if sysinfo is None or time.time() - sysinfo_at > 3600:
                try:
                    sysinfo, sysinfo_at = system_info(), time.time()
                except Exception:
                    sysinfo, sysinfo_at = None, time.time()
            payload = {
                "agentVersion": AGENT_VERSION, "hostname": socket.gethostname(), "os": os_name(),
                "observedAt": iso(t1),
                "cpuCores": os.cpu_count(), "ramTotalMb": m["total"], "diskTotalGb": d["total"],
                "memTotalMb": m["total"], "memUsedMb": m["used"], "memAvailableMb": m["avail"],
                "diskUsedGb": d["used"], "diskFreeGb": d["free"],
                "uptimeSec": float(read("/proc/uptime").split()[0]),
                "cpuPercent": cpu if cpu is not None else 0.0, "ramPercent": m["pct"], "diskPercent": d["pct"],
                "agentStartedAt": started_at,
                "load": [float(x) for x in read("/proc/loadavg").split()[:3]],
                "netInKbps": net_in, "netOutKbps": net_out,
                # Agent >= 3.3
                "cpuIowaitPercent": iowait, "cpuStealPercent": steal,
                "swapTotalMb": m["swapTotal"], "swapUsedMb": m["swapUsed"], "swapFreeMb": m["swapFree"], "swapPercent": m["swapPct"],
                "pressure": pressure(), "networkInterfaces": ifaces, "diskIo": dio, "system": sysinfo,
                "lastReportRttMs": last_rtt_ms,
            }
            # Heavier collections every 3rd report
            if tick % 3 == 0:
                errors = []
                # Time budget: slow apps / databases must never delay the report past the stale threshold
                deadline = time.time() + HEAVY_BUDGET_SEC
                def collect(key, fn):
                    if time.time() > deadline:
                        errors.append("%s: skipped (collection time budget of %ds used up)" % (key, HEAVY_BUDGET_SEC))
                        return
                    try:
                        payload[key] = fn()
                    except Exception as e:
                        errors.append("%s: %s" % (key, str(e)[:200]))
                collect("processes", processes)
                collect("services", lambda: services(watch))
                collect("logs", error_logs)
                collect("filesystems", filesystems)
                collect("failedUnits", failed_units)
                collect("listeningPorts", listening_ports)
                collect("pm2", lambda: pm2_processes(conf, payload.get("listeningPorts")))
                collect("appChecks", lambda: [r for r in (local_health(c) for c in app_checks if time.time() < deadline) if r])
                collect("ntp", ntp_status)
                try:
                    dbr = db_probe(conf) if time.time() < deadline else None
                    if dbr is not None:
                        payload["databases"] = [dbr]
                        if dbr.get("error"): errors.append("database: " + dbr["error"])
                except Exception as e:
                    errors.append("database: %s" % str(e)[:200])
                payload["errors"] = errors
            payload["sentAt"] = iso_ms(time.time())
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "scholario-agent/" + AGENT_VERSION})
            s0 = time.time()
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read(65536)
            last_rtt_ms = round((time.time() - s0) * 1000, 1)
            # The server lists the local application health checks for this host (port + health path)
            try:
                checks = (json.loads(body.decode("utf-8", "replace")).get("data") or {}).get("appChecks")
                if isinstance(checks, list):
                    app_checks = [c for c in checks if isinstance(c, dict)][:20]
            except Exception:
                pass
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
# PM2 (read-only 'pm2 jlist'; only allow-listed fields are reported, never environments).
# Empty = auto-detect running daemons in /root/.pm2 and /home/*/.pm2; PM2_BIN when pm2 is not on PATH.
PM2_HOME=
PM2_BIN=
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
