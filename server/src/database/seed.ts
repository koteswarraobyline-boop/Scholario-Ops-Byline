/**
 * Seed script — imports data from the frontend initialData.ts into PostgreSQL.
 * Run: tsx src/database/seed.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const DB_URL = process.env.DATABASE_URL!;
if (!DB_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({ connectionString: DB_URL });

// ─── Seed data (mirrors initialData.ts structure) ──────────────────────────

const APPLICATIONS = [
  { id: uuidv4(), code_name: 'cipher',          name: 'Cipher',          description: 'ICT LMS & Online Examination Core Platform',               tier: 'TIER_1', rto: 30, rpo: 15, zone: 'scholario-cipher.edu',      version: 'v2.41.0', uptime30: 99.98, p95: 298, error: 0.02 },
  { id: uuidv4(), code_name: 'apex',             name: 'Apex',            description: 'Student Information System, Records & Admissions Engine',   tier: 'TIER_1', rto: 30, rpo: 15, zone: 'apex.scholario.internal',   version: 'v3.12.4', uptime30: 99.95, p95: 310, error: 0.04 },
  { id: uuidv4(), code_name: 'nimbus',           name: 'Nimbus',          description: 'Curriculum & Digital Learning Content Delivery Engine',     tier: 'TIER_2', rto: 45, rpo: 30, zone: 'nimbus.scholario.net',      version: 'v1.89.2', uptime30: 99.91, p95: 240, error: 0.01 },
  { id: uuidv4(), code_name: 'mosaic',           name: 'Mosaic',          description: 'Analytics, Institutional Reporting & Examination Portal',   tier: 'TIER_1', rto: 30, rpo: 15, zone: 'mosaic.scholario.net',      version: 'v4.0.2',  uptime30: 99.25, p95: 4890, error: 12.8 },
  { id: uuidv4(), code_name: 'ascend',           name: 'Ascend',          description: 'Faculty, Staff Operations & Resource Scheduling Hub',       tier: 'TIER_2', rto: 45, rpo: 30, zone: 'ascend.scholario.net',      version: 'v2.18.1', uptime30: 99.96, p95: 275, error: 0.01 },
  { id: uuidv4(), code_name: 'vantage',          name: 'Vantage',         description: 'Institutional Finance, Tuition Billing & Payroll Engine',   tier: 'TIER_1', rto: 20, rpo: 5,  zone: 'vantage.scholario.internal', version: 'v1.44.8', uptime30: 99.99, p95: 195, error: 0.0  },
  { id: uuidv4(), code_name: 'lumo',             name: 'Lumo',            description: 'Central Identity, SAML/OAuth2 Single Sign-On Gateway',      tier: 'TIER_1', rto: 15, rpo: 5,  zone: 'auth.scholario.net',        version: 'v5.3.0',  uptime30: 100.0, p95: 142, error: 0.0  },
  { id: uuidv4(), code_name: 'client-platform',  name: 'Client Platform', description: 'Multi-Tenant District Admin & Guardian Mobile API Gateway',  tier: 'TIER_2', rto: 45, rpo: 30, zone: 'portal.scholario.com',      version: 'v2.8.9',  uptime30: 99.92, p95: 340, error: 0.03 },
];

const REGIONS = ['Singapore','Frankfurt','Mumbai','London'] as const;

const SERVERS_RAW = [
  { code: 'cipher',         env: 'PRD', region: 'Singapore', ip: '185.193.125.101', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 34.2, ram_pct: 61.8, disk_pct: 54.0 },
  { code: 'cipher',         env: 'DR',  region: 'Singapore', ip: '185.193.125.102', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 12.4, ram_pct: 44.1, disk_pct: 53.8 },
  { code: 'apex',           env: 'PRD', region: 'Frankfurt', ip: '185.228.140.45',  plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 28.5, ram_pct: 52.4, disk_pct: 48.2 },
  { code: 'apex',           env: 'DR',  region: 'London',    ip: '185.228.140.46',  plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 11.2, ram_pct: 38.6, disk_pct: 47.9 },
  { code: 'nimbus',         env: 'PRD', region: 'Mumbai',    ip: '194.163.142.12',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 24.1, ram_pct: 49.0, disk_pct: 62.4 },
  { code: 'nimbus',         env: 'DR',  region: 'Singapore', ip: '194.163.142.13',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 8.4,  ram_pct: 32.1, disk_pct: 61.9 },
  { code: 'mosaic',         env: 'PRD', region: 'Singapore', ip: '185.193.125.107', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 96.8, ram_pct: 94.6, disk_pct: 78.4 },
  { code: 'mosaic',         env: 'DR',  region: 'Singapore', ip: '185.193.125.108', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 46.2, ram_pct: 58.4, disk_pct: 72.1 },
  { code: 'ascend',         env: 'PRD', region: 'Frankfurt', ip: '185.228.140.61',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 21.0, ram_pct: 46.5, disk_pct: 41.2 },
  { code: 'ascend',         env: 'DR',  region: 'Frankfurt', ip: '185.228.140.62',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 7.2,  ram_pct: 30.4, disk_pct: 40.8 },
  { code: 'vantage',        env: 'PRD', region: 'Singapore', ip: '185.193.125.115', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 19.8, ram_pct: 48.2, disk_pct: 39.5 },
  { code: 'vantage',        env: 'DR',  region: 'Singapore', ip: '185.193.125.116', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 9.5,  ram_pct: 34.0, disk_pct: 39.2 },
  { code: 'lumo',           env: 'PRD', region: 'Frankfurt', ip: '185.228.140.75',  plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 16.4, ram_pct: 42.1, disk_pct: 31.8 },
  { code: 'lumo',           env: 'DR',  region: 'Singapore', ip: '185.193.125.120', plan: 'KVM 8 (8 vCPU / 32GB RAM / 400GB NVMe)', cpu: 8, ram: 32, disk: 400, cpu_pct: 8.1,  ram_pct: 29.5, disk_pct: 31.5 },
  { code: 'client-platform',env: 'PRD', region: 'London',    ip: '185.228.140.88',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 26.5, ram_pct: 51.0, disk_pct: 44.5 },
  { code: 'client-platform',env: 'DR',  region: 'Frankfurt', ip: '185.228.140.89',  plan: 'KVM 4 (4 vCPU / 16GB RAM / 200GB NVMe)', cpu: 4, ram: 16, disk: 200, cpu_pct: 9.8,  ram_pct: 33.2, disk_pct: 44.1 },
];

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database...');

    // 1. Default admin user
    const adminHash = await bcrypt.hash('Admin@Scholario2026!', 12);
    const adminRoleId = '00000000-0000-0000-0000-000000000004'; // super_admin
    const adminId = uuidv4();

    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, display_name, role_id, is_active, activated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
       ON CONFLICT (email) DO NOTHING`,
      [adminId, 'admin@scholario.net', adminHash, 'System Administrator', 'Admin', adminRoleId]
    );

    // Operator user
    const opHash = await bcrypt.hash('Operator@Scholario2026!', 12);
    const opRoleId = '00000000-0000-0000-0000-000000000002'; // operator
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, display_name, role_id, is_active, is_on_call, activated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE, NOW())
       ON CONFLICT (email) DO NOTHING`,
      [uuidv4(), 'arjun.mehta@scholario.net', opHash, 'Arjun Mehta', 'A. Mehta', opRoleId]
    );
    console.log('  ✅ Users seeded');

    // 2. Applications
    const appIdMap: Record<string, string> = {};
    for (const app of APPLICATIONS) {
      const status = app.code_name === 'mosaic' ? 'CRITICAL' : 'HEALTHY';
      const failoverState = app.code_name === 'mosaic' ? 'DR_ACTIVE' : 'PRIMARY_ACTIVE';
      await client.query(
        `INSERT INTO applications
           (id, name, code_name, description, tier, status, rto_target_min, rpo_target_min,
            cloudflare_zone, recent_deployment_version, uptime_30d, p95_ms, error_rate_percent,
            failover_state, last_checked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (code_name) DO NOTHING`,
        [app.id, app.name, app.code_name, app.description, app.tier, status,
         app.rto, app.rpo, app.zone, app.version, app.uptime30, app.p95, app.error,
         failoverState]
      );
      appIdMap[app.code_name] = app.id;
    }
    console.log('  ✅ Applications seeded');

    // 3. Servers
    const serverIdMap: Record<string, string> = {};
    for (const srv of SERVERS_RAW) {
      const id = uuidv4();
      const hostname = `${srv.region.toLowerCase().slice(0,3).replace('sin','sg').replace('fra','fra').replace('mum','in').replace('lon','lon')}-${srv.code.replace('-','')}-${srv.env.toLowerCase()}-01.scholario.net`;
      const status = srv.cpu_pct > 90 ? 'CRITICAL' : 'HEALTHY';
      const key = `${srv.code}:${srv.env}`;
      serverIdMap[key] = id;

      await client.query(
        `INSERT INTO servers
           (id, hostname, ip, application_id, environment, provider, region, plan,
            cpu_cores, ram_gb, disk_gb, os, status, agent_version, agent_status, last_seen)
         VALUES ($1,$2,$3,$4,$5,'Hostinger',$6,$7,$8,$9,$10,'Ubuntu 24.04 LTS',$11,'2.4.1','CONNECTED',NOW())
         ON CONFLICT (hostname) DO NOTHING`,
        [id, hostname, srv.ip, appIdMap[srv.code], srv.env,
         srv.region, srv.plan, srv.cpu, srv.ram, srv.disk, status]
      );

      // Seed initial metrics
      await client.query(
        `INSERT INTO server_metrics
           (id,server_id,cpu_percent,ram_percent,disk_percent,load_avg_1m,load_avg_5m,load_avg_15m,
            network_in_kbps,network_out_kbps,observed_at,received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
        [uuidv4(), id, srv.cpu_pct, srv.ram_pct, srv.disk_pct, 1.5, 1.2, 1.0, 3000, 8000]
      );
    }
    console.log('  ✅ Servers seeded (16 nodes)');

    // 4. Link PRD/DR servers to applications
    for (const app of APPLICATIONS) {
      const prdKey = `${app.code_name}:PRD`;
      const drKey = `${app.code_name}:DR`;
      if (serverIdMap[prdKey] && serverIdMap[drKey]) {
        await client.query(
          `UPDATE applications SET prd_server_id = $1, dr_server_id = $2 WHERE id = $3`,
          [serverIdMap[prdKey], serverIdMap[drKey], app.id]
        );
      }
    }
    console.log('  ✅ App ↔ server links updated');

    // 5. Seed one active critical incident (Mosaic)
    const incSeqResult = await client.query(`SELECT nextval('incident_ticket_seq')::text AS nextval`);
    const incSeqNum = incSeqResult.rows[0].nextval;
    const incId = uuidv4();
    await client.query(
      `INSERT INTO incidents
         (id,ticket_number,title,severity,status,application_id,environment,fingerprint,root_cause,
          affected_services,started_at)
       VALUES ($1,$2,$3,'CRITICAL','INVESTIGATING',$4,'PRD',$5,$6,$7,NOW() - INTERVAL '35 minutes')
       ON CONFLICT (ticket_number) DO NOTHING`,
      [incId, `INC-${incSeqNum}`,
       'Mosaic primary health check failed: MySQL connection pool starved',
       appIdMap['mosaic'],
       'mosaic:prd:monitor-mosaic-https:http_500',
       'MySQL max_connections (500) reached — connection pool exhausted by analytics report generation',
       ['Mosaic Analytics', 'Mosaic Exam Reports', 'Mosaic API']]
    );
    await client.query(
      `INSERT INTO incident_events (id,incident_id,source,level,message) VALUES
         ($1,$2,'Monitoring Engine','CRITICAL','Monitor mosaic-https CRITICAL: 3 consecutive failures confirmed'),
         ($3,$2,'Cloudflare Edge','WARN','Anycast traffic automatically rerouted to DR standby origin'),
         ($4,$2,'IT Operations','INFO','Incident opened. Assigned to Arjun Mehta (Lead On-Call)')`,
      [uuidv4(), incId, uuidv4(), uuidv4()]
    );
    console.log('  ✅ Active incident seeded (Mosaic)');

    // 6. Default notification channels
    await client.query(
      `INSERT INTO notification_channels (id,name,type,enabled,target_endpoint)
       VALUES
         ($1,'Microsoft Teams — Ops Control Center','TEAMS',TRUE,$2),
         ($3,'On-Call Email','EMAIL',TRUE,'oncall@scholario.net'),
         ($4,'Generic Ops Webhook','WEBHOOK',FALSE,'https://webhook.scholario.net/ops')
       ON CONFLICT DO NOTHING`,
      [uuidv4(), process.env.TEAMS_WEBHOOK_URL || 'https://placeholder.webhook.url',
       uuidv4(), uuidv4()]
    );
    console.log('  ✅ Notification channels seeded');

    // 7. Dead-man control plane entry
    await client.query(
      `INSERT INTO dead_man_controls
         (id,name,node_location,target_control_plane,interval_sec,tolerance_sec,status,last_heartbeat_received_at)
       VALUES ($1,'External Dead-Man Watchdog','Zurich ZH4 (ch-zurich.scholario-ops.net)',
               'https://deadman.ch-zurich.scholario-ops.net/heartbeat',15,45,'HEALTHY',NOW())
       ON CONFLICT DO NOTHING`,
      [uuidv4()]
    );
    console.log('  ✅ Dead-man watchdog entry seeded');

    // 8. Seed Cloudflare zones
    const mosaicZoneId = uuidv4();
    await client.query(
      `INSERT INTO cloudflare_zones (id,domain,status,ssl_status,tls_version,waf_events_24h,drift_detected,last_checked)
       VALUES ($1,'mosaic.scholario.net','DEGRADED','ACTIVE','TLS 1.3',142,TRUE,NOW())
       ON CONFLICT (domain) DO NOTHING`,
      [mosaicZoneId]
    );
    await client.query(
      `INSERT INTO cloudflare_load_balancers (id,zone_id,pool_name,primary_origin,dr_origin,active_origin,health_check_status,failover_policy,last_rerouted_at)
       VALUES ($1,$2,'mosaic-lb-pool','185.193.125.107','185.193.125.108','185.193.125.108 (DR Active)','UNHEALTHY','AUTOMATIC_WITH_CONFIRMATION',NOW())
       ON CONFLICT DO NOTHING`,
      [uuidv4(), mosaicZoneId]
    );
    console.log('  ✅ Cloudflare zones seeded');

    // 9. Seed a sample runbook
    const rbId = uuidv4();
    await client.query(
      `INSERT INTO runbooks (id,title,description,category,estimated_duration_min,created_by_id)
       VALUES ($1,'MySQL Connection Pool Recovery','Procedure to recover from MySQL max_connections exhaustion','DATABASE',15,$2)
       ON CONFLICT DO NOTHING`,
      [rbId, adminId]
    );
    const steps = [
      [1, 'Identify connection sources', 'Run SHOW PROCESSLIST and identify sessions consuming connections', 'SHOW FULL PROCESSLIST;'],
      [2, 'Kill long-running queries', 'Kill sessions blocking connection slots', 'SELECT CONCAT("KILL ", id, ";") FROM information_schema.processlist WHERE time > 60;'],
      [3, 'Increase max_connections temporarily', 'Apply dynamic variable change (does not persist across restart)', 'SET GLOBAL max_connections = 600;'],
      [4, 'Verify connection count drops', 'Monitor connection count over 60 seconds', 'SHOW STATUS LIKE "Threads_connected";'],
      [5, 'Confirm health monitors pass', 'Wait for 3 consecutive HEALTHY checks before marking resolved', 'Watch monitor dashboard'],
    ];
    for (const [order, title, instruction, command] of steps) {
      await client.query(
        `INSERT INTO runbook_steps (id,runbook_id,step_order,title,instruction,command) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uuidv4(), rbId, order, title, instruction, command]
      );
    }
    console.log('  ✅ Runbooks seeded');

    await client.query('COMMIT');
    console.log('\n✅ Seed complete.');
    console.log('\nDefault credentials:');
    console.log('  Admin:    admin@scholario.net    / Admin@Scholario2026!');
    console.log('  Operator: arjun.mehta@scholario.net / Operator@Scholario2026!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
