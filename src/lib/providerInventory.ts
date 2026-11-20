import type { ProviderDisplayStatus, ProviderInstanceView, ProviderSyncStatus } from '../types/index.ts';

/** Badge for a connection. Authentication and sync failures stay visible when sync is turned off. */
export function providerDisplayStatus(c: { tokenConfigured: boolean; syncEnabled: boolean; status: ProviderSyncStatus }): ProviderDisplayStatus {
  if (!c.tokenConfigured) return 'NOT_CONFIGURED';
  if (c.status === 'AUTH_FAILED') return 'AUTH_FAILED';
  if (c.status === 'ERROR' || c.status === 'RATE_LIMITED') return 'SYNC_FAILED';
  if (!c.syncEnabled) return 'DISABLED';
  if (c.status === 'OK') return 'CONNECTED';
  return 'NOT_SYNCED';
}

export const PROVIDER_DISPLAY_LABEL: Record<ProviderDisplayStatus, string> = {
  NOT_CONFIGURED: 'Not configured',
  CONNECTED: 'Connected',
  AUTH_FAILED: 'Authentication failed',
  SYNC_FAILED: 'Sync failed',
  NOT_SYNCED: 'Not synced yet',
  DISABLED: 'Sync disabled',
};

export interface ProviderInventoryQuery {
  provider?: string;
  connectionId?: string;
  connectionStatus?: string;
  region?: string;
  status?: string;
  q?: string;
}

const NONE_REGION = '__none__';

/** Combined filters. Every set field must match. Search covers hostname, IP addresses and the provider VM id. */
export function filterProviderInstances(
  instances: ProviderInstanceView[],
  connections: Array<{ id: string; displayStatus: string }>,
  query: ProviderInventoryQuery,
): ProviderInstanceView[] {
  const provider = query.provider?.trim().toLowerCase() ?? '';
  const connectionId = query.connectionId?.trim() ?? '';
  const connectionStatus = query.connectionStatus?.trim() ?? '';
  const region = query.region?.trim().toLowerCase() ?? '';
  const status = query.status?.trim().toUpperCase() ?? '';
  const q = query.q?.trim().toLowerCase() ?? '';
  const statusByConnection = new Map(connections.map(c => [c.id, c.displayStatus]));
  return instances.filter(vm => {
    if (provider && vm.provider !== provider) return false;
    if (connectionId && vm.connectionId !== connectionId) return false;
    if (connectionStatus && statusByConnection.get(vm.connectionId) !== connectionStatus) return false;
    if (region === NONE_REGION) {
      if (vm.region) return false;
    } else if (region && (vm.region ?? '').toLowerCase() !== region) return false;
    if (status && vm.status !== status) return false;
    if (q) {
      const hay = [vm.hostname, vm.providerVmId, vm.connectionName, ...vm.ipv4, ...vm.ipv6].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const providerRegionFilterValue = (region: string | null) => (region ? region : NONE_REGION);
