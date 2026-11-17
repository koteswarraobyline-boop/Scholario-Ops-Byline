/**
 * Go-live verification for one application.
 *
 * Both URLs must have answered their monitors, both agents must be CONNECTED, a Load Balancer
 * application's Cloudflare pools and origins must have been read, and the DR readiness score
 * is reviewed (READY is a pass). A run is recorded only when every applicable check passes,
 * or when each failure is covered by a logged defect.
 */
import crypto from 'crypto';
import type { Application, GoLiveCheck, GoLivePreview, GoLiveRun } from '../src/types/index.ts';
import { db } from './store.ts';
import { audit } from './events.ts';
import { ValidationError } from './validate.ts';
import { serverFor, urlMonitor } from './health.ts';
import { readiness } from './readiness.ts';
import { poolFor } from './loadbalancer.ts';

const GO_LIVE_KEEP = 500;

function pass(key: string, label: string, detail: string): GoLiveCheck {
  return { key, label, status: 'PASS', detail };
}
function fail(key: string, label: string, detail: string): GoLiveCheck {
  return { key, label, status: 'FAIL', detail };
}
function skip(key: string, label: string, detail: string): GoLiveCheck {
  return { key, label, status: 'NOT_APPLICABLE', detail };
}

function drConfigured(app: Application): boolean {
  return Boolean(app.drServerId || app.drUrl || app.loadBalancer?.drPoolId);
}

function urlAnswered(app: Application, env: 'PRD' | 'DR'): GoLiveCheck {
  const label = `${env} URL answers the monitor`;
  const key = env === 'PRD' ? 'prd_url' : 'dr_url';
  if (env === 'DR' && !drConfigured(app)) return skip(key, label, 'DR is not configured for this application');
  const monitor = urlMonitor(app, env);
  if (!monitor) return fail(key, label, `No ${env} URL monitor is enabled`);
  if (!monitor.lastCheck || monitor.lastStatusCode == null) {
    return fail(key, label, `${monitor.name} has not received an HTTP answer${monitor.lastProbeStatus ? ` (${monitor.lastProbeStatus})` : ''}`);
  }
  if (monitor.status !== 'HEALTHY') {
    return fail(key, label, `${monitor.target} answered HTTP ${monitor.lastStatusCode}, and the monitor is ${monitor.status}`);
  }
  return pass(key, label, `${monitor.target} answered HTTP ${monitor.lastStatusCode}`);
}

function agentConnected(app: Application, env: 'PRD' | 'DR'): GoLiveCheck {
  const label = `${env} agent is CONNECTED`;
  const key = env === 'PRD' ? 'prd_agent' : 'dr_agent';
  if (env === 'DR' && !drConfigured(app)) return skip(key, label, 'DR is not configured for this application');
  const server = serverFor(app, env);
  if (!server) return fail(key, label, `No ${env} server is linked`);
  if (server.agentStatus === 'CONNECTED' && server.lastSeen) {
    return pass(key, label, `${server.hostname} (${server.ip}) last reported ${server.lastSeen}`);
  }
  return fail(key, label, `${server.hostname} (${server.ip}) agent is ${server.agentStatus || 'not connected'}`);
}

function loadBalancerMapped(app: Application): boolean {
  return Boolean(app.loadBalancer?.prdPoolId || app.loadBalancer?.drPoolId);
}

function poolsRead(app: Application): GoLiveCheck {
  const label = 'Cloudflare pools are read';
  if (!loadBalancerMapped(app)) return skip('cf_pools', label, 'This application is not on a Cloudflare Load Balancer');
  const sides = (['PRD', 'DR'] as const).filter(env => (env === 'PRD' ? app.loadBalancer?.prdPoolId : app.loadBalancer?.drPoolId));
  const missing = sides.filter(env => {
    const pool = poolFor(app, env);
    return !pool?.found || !pool.listFetchedAt;
  });
  if (missing.length) {
    return fail('cf_pools', label, `${missing.join(' and ')} pool has not been read from Cloudflare`);
  }
  const names = sides.map(env => poolFor(app, env)?.name || env);
  return pass('cf_pools', label, names.join(', '));
}

function originsRead(app: Application): GoLiveCheck {
  const label = 'Cloudflare origins are read';
  if (!loadBalancerMapped(app)) return skip('cf_origins', label, 'This application is not on a Cloudflare Load Balancer');
  const sides = (['PRD', 'DR'] as const).filter(env => (env === 'PRD' ? app.loadBalancer?.prdPoolId : app.loadBalancer?.drPoolId));
  const problems: string[] = [];
  for (const env of sides) {
    const pool = poolFor(app, env);
    if (!pool?.found) {
      problems.push(`${env} pool was not read`);
      continue;
    }
    if (!pool.origins.length) problems.push(`${pool.name || env} returned no origins`);
    if (pool.healthError || !pool.healthFetchedAt) problems.push(`${pool.name || env} origin health was not read${pool.healthError ? `: ${pool.healthError}` : ''}`);
  }
  if (problems.length) return fail('cf_origins', label, problems.join('; '));
  const count = sides.reduce((n, env) => n + (poolFor(app, env)?.origins.length ?? 0), 0);
  return pass('cf_origins', label, `${count} origin${count === 1 ? '' : 's'} read`);
}

export function latestGoLive(applicationId: string): GoLiveRun | null {
  let latest: GoLiveRun | null = null;
  for (const run of db.goLiveRuns) {
    if (run.applicationId !== applicationId) continue;
    if (!latest || run.recordedAt > latest.recordedAt) latest = run;
  }
  return latest;
}

/** Current checks. Does not record a result. */
export function evaluateGoLive(app: Application): GoLivePreview {
  const score = readiness(app);
  const scoreDetail = `${score.overall} ${score.passed}/${score.total}`;
  const checks: GoLiveCheck[] = [
    urlAnswered(app, 'PRD'),
    urlAnswered(app, 'DR'),
    agentConnected(app, 'PRD'),
    agentConnected(app, 'DR'),
    poolsRead(app),
    originsRead(app),
    score.overall === 'READY'
      ? pass('dr_score', 'DR score reviewed', scoreDetail)
      : fail('dr_score', 'DR score reviewed', `${scoreDetail} — the score is not READY`),
  ];
  return {
    applicationId: app.id,
    applicationName: app.name,
    overall: checks.some(check => check.status === 'FAIL') ? 'FAILED' : 'GREEN',
    checks,
    drOverall: score.overall,
    drPassed: score.passed,
    drTotal: score.total,
    evaluatedAt: score.evaluatedAt,
    latest: latestGoLive(app.id),
  };
}

/**
 * Records the current checks. A failure is not stored as a silent pass: the caller must
 * supply a defect summary, or fix the checks and record again.
 */
export function recordGoLive(app: Application, operator: string, defect: string | undefined): GoLiveRun {
  const preview = evaluateGoLive(app);
  const failed = preview.checks.filter(check => check.status === 'FAIL');
  const note = defect?.trim() ?? '';
  if (failed.length && !note) {
    throw new ValidationError(`Go-live is not green (${failed.map(check => check.label).join(', ')}). Fix the checks or log a defect.`);
  }
  const now = new Date().toISOString();
  const run: GoLiveRun = {
    id: crypto.randomUUID(),
    applicationId: app.id,
    applicationName: app.name,
    overall: failed.length ? 'FAILED' : 'GREEN',
    checks: preview.checks,
    drOverall: preview.drOverall,
    drPassed: preview.drPassed,
    drTotal: preview.drTotal,
    defect: failed.length ? { summary: note, loggedBy: operator, loggedAt: now } : null,
    operator,
    recordedAt: now,
  };
  db.goLiveRuns.unshift(run);
  if (db.goLiveRuns.length > GO_LIVE_KEEP) db.goLiveRuns.length = GO_LIVE_KEEP;
  const names = preview.checks.map(check => `${check.key}=${check.status}`).join(', ');
  audit(operator, run.overall === 'GREEN' ? 'GO_LIVE_PASSED' : 'GO_LIVE_FAILED', 'APPLICATION', app.id,
    `${app.name} go-live ${run.overall}. DR score ${run.drOverall} ${run.drPassed}/${run.drTotal}. ${names}${run.defect ? `. Defect: ${run.defect.summary}` : ''}`);
  return run;
}
