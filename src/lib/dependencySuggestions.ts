import type { Application, DependencyLink, RegistryComponent } from '../types/index.ts';

/** A database named on the application inventory, not yet recorded as a dependency. The owner confirms it. */
export interface DependencySuggestion {
  key: string;
  name: string;
  endpoint: string;
  notes: string;
}

/**
 * Suggestions come from the database name and engine already saved on the application.
 * Hosting servers are not suggested. No password is included. An empty list is valid.
 */
export function databaseSuggestions(input: {
  app: Pick<Application, 'id' | 'prdServerId' | 'drServerId' | 'environments'>;
  servers: readonly { id: string; hostname: string }[];
  registry: readonly Pick<RegistryComponent, 'id' | 'kind' | 'name' | 'applicationId'>[];
  links: readonly Pick<DependencyLink, 'fromId' | 'toId'>[];
  dismissed: readonly string[];
}): DependencySuggestion[] {
  const dismissed = new Set(input.dismissed);
  const component = input.registry.find(c => c.kind === 'APPLICATION' && c.applicationId === input.app.id);
  const linkedNames = new Set(
    input.links
      .filter(link => component && link.fromId === component.id)
      .map(link => input.registry.find(c => c.id === link.toId))
      .filter(c => c?.kind === 'DATABASE')
      .map(c => c!.name.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const out: DependencySuggestion[] = [];
  for (const env of ['PRD', 'DR'] as const) {
    const inventory = input.app.environments?.[env];
    if (!inventory?.dbName && !inventory?.dbEngine) continue;
    const engine = inventory.dbEngine ?? 'database';
    const name = inventory.dbName ? `${engine} ${inventory.dbName}` : `${engine} database`;
    const key = `${input.app.id}:${name.trim().toLowerCase()}`;
    if (seen.has(key) || dismissed.has(key) || linkedNames.has(name.trim().toLowerCase())) continue;
    seen.add(key);
    const serverId = env === 'PRD' ? input.app.prdServerId : input.app.drServerId;
    const host = input.servers.find(s => s.id === serverId)?.hostname ?? '';
    const endpoint = [host, inventory.dbPort ? String(inventory.dbPort) : '', inventory.dbName ?? ''].filter(Boolean).join(' ');
    out.push({
      key,
      name,
      endpoint,
      notes: `${env} inventory names this database. Confirmed by the owner.`,
    });
  }
  return out;
}
