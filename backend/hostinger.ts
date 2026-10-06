import { config, isHostingerConfigured } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast } from './events.ts';

const API = 'https://developers.hostinger.com/api/vps/v1/virtual-machines';

/** Shape of a VM from the Hostinger VPS API (fields are read defensively). */
interface HostingerVm {
  id: number;
  hostname?: string;
  state?: string;
  cpus?: number;
  memory?: number; // MB
  disk?: number;   // MB
  plan?: string | null;
  ipv4?: Array<{ address?: string }> | null;
  ipv6?: Array<{ address?: string }> | null;
  template?: { name?: string } | null;
  data_center?: { name?: string; location?: string; city?: string } | null;
}

export const hostingerState = {
  vms: [] as HostingerVm[],
  lastSyncAt: null as string | null,
  lastError: null as string | null,
};

export async function syncHostinger(): Promise<void> {
  if (!isHostingerConfigured()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(API, {
      headers: { Authorization: `Bearer ${config.hostingerApiToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Hostinger API HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const body = await resp.json() as HostingerVm[] | { data?: HostingerVm[] };
    const vms = Array.isArray(body) ? body : (body.data ?? []);
    hostingerState.vms = vms;
    hostingerState.lastSyncAt = new Date().toISOString();
    hostingerState.lastError = null;

    // Enrich registered servers that match a VM by IP. Agent-reported values win when present.
    let changed = false;
    for (const srv of db.servers) {
      const vm = vms.find(v => (v.ipv4 ?? []).some(a => a.address === srv.ip) || (v.ipv6 ?? []).some(a => a.address === srv.ip));
      if (!vm) continue;
      srv.hostingerVmId = vm.id;
      srv.hostingerState = vm.state;
      if (vm.plan) srv.plan = vm.plan;
      if (!srv.cpuCores && vm.cpus) srv.cpuCores = vm.cpus;
      if (!srv.ramGb && vm.memory) srv.ramGb = Math.round(vm.memory / 1024);
      if (!srv.diskGb && vm.disk) srv.diskGb = Math.round(vm.disk / 1024);
      if (!srv.os && vm.template?.name) srv.os = vm.template.name;
      const dc = vm.data_center?.city || vm.data_center?.location || vm.data_center?.name;
      if (dc && (!srv.region || srv.region === 'Unknown')) srv.region = dc;
      changed = true;
    }
    if (changed) {
      persist();
      broadcast('servers_changed', null);
    }
  } catch (err) {
    hostingerState.lastError = (err as Error).name === 'AbortError' ? 'Hostinger API timeout' : (err as Error).message;
    console.error(`[hostinger] sync failed: ${hostingerState.lastError}`);
    throw new Error(hostingerState.lastError);
  } finally {
    clearTimeout(timer);
  }
}
