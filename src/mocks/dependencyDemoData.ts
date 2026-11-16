import type { DependencyLink, DependencyMethod, RegistryComponent, RegistryKind } from '../types';

/**
 * Illustrative dependency picture for the on-screen DEMO mode.
 * These rows are not verified relationships and are never sent to the API.
 */

export const DEMO_BANNER = 'DEMO MODE — SIMULATED DATA — NOT LIVE PRODUCTION STATUS';

export const DEMO_APP_NAMES = [
  'QR Videos',
  'Scholario Social LMS',
  'Scholario Ascend',
  'Vantage',
  'LXP Portal',
  'Scholario Lumo',
  'Scholario Websites',
  'Scholario KG LMS',
  'ICT (Cipher LMS)',
] as const;

const INFRA = [
  'Central PostgreSQL Database',
  'Shared Object Storage',
  'External Payment API',
  'Email Delivery Provider',
] as const;

export type DemoVisual = 'UNKNOWN' | 'SIMULATED_FAILURE' | 'SIMULATED_CRITICAL' | 'SIMULATED_WARNING';

export interface DemoScenario {
  id: string;
  label: string;
  rootName: string;
  summary: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  { id: 'lxp', label: 'LXP Portal unavailable', rootName: 'LXP Portal', summary: 'Illustrative identity hub failure.' },
  { id: 'database', label: 'Central database unavailable', rootName: 'Central PostgreSQL Database', summary: 'Illustrative database failure.' },
  { id: 'email', label: 'Email provider unavailable', rootName: 'Email Delivery Provider', summary: 'Illustrative mail failure.' },
  { id: 'storage', label: 'Object storage unavailable', rootName: 'Shared Object Storage', summary: 'Illustrative storage failure.' },
  { id: 'social', label: 'Scholario Social LMS unavailable', rootName: 'Scholario Social LMS', summary: 'Illustrative social platform failure.' },
];

interface Seed {
  id: string;
  name: string;
  kind: RegistryKind;
  tier: RegistryComponent['tier'];
  users: number | null;
  feature: string;
}

const SEEDS: Seed[] = [
  { id: 'demo-lxp', name: 'LXP Portal', kind: 'APPLICATION', tier: 'TIER_1', users: 4200, feature: 'Sign-in and catalogue' },
  { id: 'demo-social', name: 'Scholario Social LMS', kind: 'APPLICATION', tier: 'TIER_2', users: 2600, feature: 'Feed and profile' },
  { id: 'demo-ascend', name: 'Scholario Ascend', kind: 'APPLICATION', tier: 'TIER_2', users: 3100, feature: 'Learning home' },
  { id: 'demo-vantage', name: 'Vantage', kind: 'APPLICATION', tier: 'TIER_2', users: 900, feature: 'Lesson planner' },
  { id: 'demo-qr', name: 'QR Videos', kind: 'APPLICATION', tier: 'TIER_2', users: 1100, feature: 'Video playback' },
  { id: 'demo-lumo', name: 'Scholario Lumo', kind: 'APPLICATION', tier: 'TIER_2', users: 700, feature: 'Learning session' },
  { id: 'demo-web', name: 'Scholario Websites', kind: 'APPLICATION', tier: 'TIER_3', users: 400, feature: 'Public pages' },
  { id: 'demo-kg', name: 'Scholario KG LMS', kind: 'APPLICATION', tier: 'TIER_2', users: 1800, feature: 'Course delivery' },
  { id: 'demo-ict', name: 'ICT (Cipher LMS)', kind: 'APPLICATION', tier: 'TIER_1', users: 1500, feature: 'Course and lab access' },
  { id: 'demo-db', name: 'Central PostgreSQL Database', kind: 'DATABASE', tier: 'TIER_1', users: null, feature: 'Queries' },
  { id: 'demo-storage', name: 'Shared Object Storage', kind: 'STORAGE', tier: 'TIER_2', users: null, feature: 'Object reads' },
  { id: 'demo-pay', name: 'External Payment API', kind: 'THIRD_PARTY_API', tier: 'TIER_2', users: null, feature: 'Checkout' },
  { id: 'demo-email', name: 'Email Delivery Provider', kind: 'PROVIDER', tier: 'TIER_3', users: null, feature: 'Outbound mail' },
];

interface LinkSeed {
  id: string;
  consumer: string;
  provider: string;
  type: 'HARD' | 'SOFT';
  method: DependencyMethod;
  rationale: string;
  /** Named in the demonstration table. Infrastructure rows are extra illustrations. */
  fromTable: boolean;
}

const LINK_SEEDS: LinkSeed[] = [
  { id: 'demo-link-qr-lxp', consumer: 'QR Videos', provider: 'LXP Portal', type: 'SOFT', method: 'API', rationale: 'Reads authentication and user session information', fromTable: true },
  { id: 'demo-link-qr-social', consumer: 'QR Videos', provider: 'Scholario Social LMS', type: 'SOFT', method: 'API', rationale: 'Shares user profile information', fromTable: true },
  { id: 'demo-link-social-lxp', consumer: 'Scholario Social LMS', provider: 'LXP Portal', type: 'HARD', method: 'DATABASE', rationale: 'Reads central user and authentication records', fromTable: true },
  { id: 'demo-link-ascend-lxp', consumer: 'Scholario Ascend', provider: 'LXP Portal', type: 'HARD', method: 'API', rationale: 'Uses centralized authentication', fromTable: true },
  { id: 'demo-link-ascend-social', consumer: 'Scholario Ascend', provider: 'Scholario Social LMS', type: 'SOFT', method: 'API', rationale: 'Retrieves user profile information', fromTable: true },
  { id: 'demo-link-vantage-lxp', consumer: 'Vantage', provider: 'LXP Portal', type: 'HARD', method: 'API', rationale: 'Uses central login and identity services', fromTable: true },
  { id: 'demo-link-vantage-kg', consumer: 'Vantage', provider: 'Scholario KG LMS', type: 'SOFT', method: 'DATABASE', rationale: 'Retrieves learning and course information', fromTable: true },
  { id: 'demo-link-lumo-lxp', consumer: 'Scholario Lumo', provider: 'LXP Portal', type: 'HARD', method: 'API', rationale: 'Uses central authentication', fromTable: true },
  { id: 'demo-link-lumo-web', consumer: 'Scholario Lumo', provider: 'Scholario Websites', type: 'SOFT', method: 'EMBED', rationale: 'Embeds public learning content', fromTable: true },
  { id: 'demo-link-kg-lxp', consumer: 'Scholario KG LMS', provider: 'LXP Portal', type: 'HARD', method: 'API', rationale: 'Uses centralized authentication', fromTable: true },
  { id: 'demo-link-kg-web', consumer: 'Scholario KG LMS', provider: 'Scholario Websites', type: 'SOFT', method: 'HTTP', rationale: 'Retrieves public learning content', fromTable: true },
  { id: 'demo-link-ict-lxp', consumer: 'ICT (Cipher LMS)', provider: 'LXP Portal', type: 'SOFT', method: 'API', rationale: 'Uses shared identity services', fromTable: true },
  { id: 'demo-link-web-lxp', consumer: 'Scholario Websites', provider: 'LXP Portal', type: 'SOFT', method: 'API', rationale: 'Retrieves public-facing identity information', fromTable: true },
  { id: 'demo-link-lxp-db', consumer: 'LXP Portal', provider: 'Central PostgreSQL Database', type: 'HARD', method: 'DATABASE', rationale: 'Illustrative: identity records for the hub', fromTable: false },
  { id: 'demo-link-qr-storage', consumer: 'QR Videos', provider: 'Shared Object Storage', type: 'HARD', method: 'API', rationale: 'Illustrative: video objects', fromTable: false },
  { id: 'demo-link-web-email', consumer: 'Scholario Websites', provider: 'Email Delivery Provider', type: 'SOFT', method: 'API', rationale: 'Illustrative: public site mail', fromTable: false },
  { id: 'demo-link-social-email', consumer: 'Scholario Social LMS', provider: 'Email Delivery Provider', type: 'SOFT', method: 'API', rationale: 'Illustrative: notification mail', fromTable: false },
  { id: 'demo-link-web-pay', consumer: 'Scholario Websites', provider: 'External Payment API', type: 'SOFT', method: 'API', rationale: 'Illustrative: checkout on the public site', fromTable: false },
];

const STAMP = '2026-01-01T00:00:00.000Z';

const byName = new Map(SEEDS.map(seed => [seed.name, seed]));

export function demoComponents(): RegistryComponent[] {
  return SEEDS.map(seed => ({
    id: seed.id,
    kind: seed.kind,
    name: seed.name,
    owner: 'DEMO (illustrative)',
    tier: seed.tier,
    description: 'Illustrative demo component. Not a verified production dependency.',
    applicationId: null,
    serverId: null,
    userCount: seed.users,
    served: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  }));
}

export function demoDependencyLinks(): DependencyLink[] {
  return LINK_SEEDS.map(seed => ({
    id: seed.id,
    fromId: byName.get(seed.consumer)!.id,
    toId: byName.get(seed.provider)!.id,
    type: seed.type,
    featureId: null,
    method: seed.method,
    notes: seed.rationale,
    createdAt: STAMP,
    updatedAt: STAMP,
  }));
}

export function demoFeature(name: string): string {
  return byName.get(name)?.feature ?? 'Feature not recorded in the demo';
}

export interface DemoImpactRow {
  id: string;
  name: string;
  kind: RegistryKind;
  tier: RegistryComponent['tier'];
  depth: number;
  via: 'HARD' | 'SOFT';
  users: number | null;
  feature: string;
}

export interface DemoSimulation {
  rootId: string;
  rootName: string;
  direct: DemoImpactRow[];
  indirect: DemoImpactRow[];
  visual: Map<string, DemoVisual>;
  affectedApplications: number;
}

/** Isolated walk of the demo links. Provider failure moves toward consumers. Not the server calculator. */
export function simulateDemoFailure(rootName: string): DemoSimulation | null {
  const root = byName.get(rootName);
  if (!root) return null;
  const links = demoDependencyLinks();
  const best = new Map<string, { depth: number; allHard: boolean }>();
  const queue: Array<{ id: string; depth: number; allHard: boolean }> = [{ id: root.id, depth: 0, allHard: true }];
  best.set(root.id, { depth: 0, allHard: true });
  while (queue.length) {
    const current = queue.shift()!;
    for (const link of links) {
      if (link.toId !== current.id) continue;
      const next = { depth: current.depth + 1, allHard: current.allHard && link.type === 'HARD' };
      const previous = best.get(link.fromId);
      const better = !previous
        || (next.allHard && !previous.allHard)
        || (next.allHard === previous.allHard && next.depth < previous.depth);
      if (!better) continue;
      best.set(link.fromId, next);
      queue.push({ id: link.fromId, ...next });
    }
  }
  const rowFor = (id: string, depth: number, allHard: boolean): DemoImpactRow => {
    const seed = SEEDS.find(item => item.id === id)!;
    return {
      id,
      name: seed.name,
      kind: seed.kind,
      tier: seed.tier,
      depth,
      via: allHard ? 'HARD' : 'SOFT',
      users: seed.users,
      feature: seed.feature,
    };
  };
  const direct: DemoImpactRow[] = [];
  const indirect: DemoImpactRow[] = [];
  const visual = new Map<string, DemoVisual>();
  visual.set(root.id, 'SIMULATED_FAILURE');
  for (const [id, hit] of best) {
    if (id === root.id) continue;
    const row = rowFor(id, hit.depth, hit.allHard);
    visual.set(id, hit.allHard ? 'SIMULATED_CRITICAL' : 'SIMULATED_WARNING');
    if (hit.depth === 1) direct.push(row);
    else indirect.push(row);
  }
  direct.sort((a, b) => a.name.localeCompare(b.name));
  indirect.sort((a, b) => a.name.localeCompare(b.name));
  const affectedApplications = [...direct, ...indirect].filter(row => row.kind === 'APPLICATION').length;
  return { rootId: root.id, rootName: root.name, direct, indirect, visual, affectedApplications };
}

export function demoVisualLabel(visual: DemoVisual): string {
  if (visual === 'SIMULATED_FAILURE') return 'SIMULATED FAILURE';
  if (visual === 'SIMULATED_CRITICAL') return 'SIMULATED CRITICAL';
  if (visual === 'SIMULATED_WARNING') return 'SIMULATED WARNING';
  return 'UNKNOWN';
}

export interface DemoIncidentView {
  id: string;
  title: string;
  detectedAt: string;
  recovery: string;
  timeline: Array<{ at: string; text: string }>;
  simulation: DemoSimulation;
}

export function demoIncident(scenario: DemoScenario): DemoIncidentView | null {
  const simulation = simulateDemoFailure(scenario.rootName);
  if (!simulation) return null;
  return {
    id: `DEMO-${scenario.id.toUpperCase()}`,
    title: `${scenario.rootName} unavailable`,
    detectedAt: '2026-11-16T09:00:00.000Z',
    recovery: 'Not recovered. DEMO mode does not close a live incident and does not confirm provider health.',
    timeline: [
      { at: '09:00', text: `Illustrative detection: ${scenario.rootName} marked SIMULATED FAILURE.` },
      { at: '09:01', text: `${simulation.direct.length} direct and ${simulation.indirect.length} indirect demo components painted from the mock links.` },
      { at: '09:02', text: 'No monitor was changed. No incident record was written.' },
    ],
    simulation,
  };
}

export function demoLinksFor(name: string): { outgoing: DependencyLink[]; incoming: DependencyLink[] } {
  const seed = byName.get(name);
  if (!seed) return { outgoing: [], incoming: [] };
  const links = demoDependencyLinks();
  return {
    outgoing: links.filter(link => link.fromId === seed.id),
    incoming: links.filter(link => link.toId === seed.id),
  };
}

export function demoNameById(id: string): string {
  return SEEDS.find(seed => seed.id === id)?.name ?? 'Unknown';
}

export const DEMO_TABLE_LINKS = LINK_SEEDS.filter(seed => seed.fromTable);
export const DEMO_INFRA_NAMES = INFRA;
