# Exercises db_probe() of the generated agent with simulated mysql/psql output (no real database).
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("agent", sys.argv[1])
agent = importlib.util.module_from_spec(spec); spec.loader.exec_module(agent)

def run(fake, conf):
    agent._cmd = fake
    return agent.db_probe(conf)

def mysql_ok(args, env=None, timeout=10):
    sql = args[-1]
    if sql == "SELECT 1": return "1", 3
    if sql == "SELECT VERSION()": return "10.11.6-MariaDB", 1
    if "Threads_connected" in sql: return "Threads_connected\t12", 1
    if "max_connections" in sql: return "max_connections\t151", 1
    if "processlist" in sql: return "0", 1
    if "information_schema.tables" in sql: return "5368709120", 1
    if "REPLICA STATUS" in sql or "SLAVE STATUS" in sql:
        return "Slave_IO_Running: Yes\nSlave_SQL_Running: Yes\nSeconds_Behind_Master: 4\nLast_Error: ", 1
    raise RuntimeError("unexpected " + sql)

def mysql_down(args, env=None, timeout=10):
    raise RuntimeError("ERROR 2002 (HY000): Can't connect to local server through socket")

def mysql_repl_broken(args, env=None, timeout=10):
    if "REPLICA STATUS" in args[-1] or "SLAVE STATUS" in args[-1]:
        return "Slave_IO_Running: No\nSlave_SQL_Running: Yes\nSeconds_Behind_Master: NULL\nLast_IO_Error: error connecting to master", 1
    return mysql_ok(args, env, timeout)

def pg_replica(args, env=None, timeout=10):
    sql = args[-1]
    answers = {"SELECT 1": "1", "SHOW server_version": "16.4", "SELECT pg_is_in_recovery()": "t", "SHOW max_connections": "100"}
    if sql in answers: return answers[sql], 2
    if "pg_database_size" in sql: return "1048576", 1
    if "count(*) FROM pg_stat_activity WHERE" in sql: return "1", 1
    if "count(*) FROM pg_stat_activity" in sql: return "9", 1
    if "pg_last_xact_replay_timestamp())::int" in sql: return "7", 1
    if "to_char" in sql: return "2026-10-06T10:00:00Z", 1
    if "pg_stat_wal_receiver" in sql: return "streaming", 1
    raise RuntimeError("unexpected " + sql)

cases = {
    "mariadb healthy replica": run(mysql_ok, {"DB_ENGINE": "mariadb", "DB_NAME": "moodle"}),
    "mysql unavailable": run(mysql_down, {"DB_ENGINE": "mysql"}),
    "mysql replication broken": run(mysql_repl_broken, {"DB_ENGINE": "mysql", "DB_NAME": "moodle"}),
    "postgresql replica": run(pg_replica, {"DB_ENGINE": "postgresql", "DB_NAME": "app"}),
    "not configured": run(mysql_ok, {}),
}
for k, v in cases.items(): print(k, "=>", json.dumps(v))
c = cases
assert c["mariadb healthy replica"]["available"] and c["mariadb healthy replica"]["replication"]["state"] == "running" and c["mariadb healthy replica"]["replication"]["lagSec"] == 4 and c["mariadb healthy replica"]["sizeBytes"] == 5368709120
assert c["mysql unavailable"]["available"] is False and "Can't connect" in c["mysql unavailable"]["error"]
assert c["mysql replication broken"]["replication"]["state"] == "error" and c["mysql replication broken"]["replication"]["lagSec"] is None
assert c["postgresql replica"]["replication"] == {"role": "replica", "state": "running", "lagSec": 7, "lastSuccessAt": "2026-10-06T10:00:00Z", "error": None}
assert c["not configured"] is None
# Remote database: the replica-status call keeps -h / -P (only -N / -B are dropped for the vertical output)
seen = []
def mysql_remote(args, env=None, timeout=10):
    seen.append(list(args))
    return mysql_ok(args, env, timeout)
remote = run(mysql_remote, {"DB_ENGINE": "mysql", "DB_NAME": "moodle", "DB_HOST": "10.0.0.5", "DB_PORT": "3307"})
status_calls = [c for c in seen if "REPLICA STATUS" in c[-1] or "SLAVE STATUS" in c[-1]]
assert status_calls, "replica status queried"
for c in status_calls:
    assert "-h" in c and "10.0.0.5" in c and "-P" in c and "3307" in c, c
    assert "-N" not in c and "-B" not in c, c
assert remote["replication"]["state"] == "running"
print("ALL AGENT DB PROBE CHECKS PASSED")
