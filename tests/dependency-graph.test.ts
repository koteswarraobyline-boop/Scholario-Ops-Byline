/**
 * Dependency graph rendering. No database and no browser: statuses and labels only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DependencyGraph, directNeighborhood, graphColumns, liveRegistryStatus } from '../src/components/resilience/DependencyGraph.tsx';
import type { Application, DependencyLink, RegistryComponent } from '../src/types/index.ts';

const now = '2026-01-01T00:00:00.000Z';

const component = (partial: Pick<RegistryComponent, 'id' | 'kind' | 'name'> & Partial<RegistryComponent>): RegistryComponent => ({
  owner: 'Owner',
  tier: 'TIER_1',
  description: '',
  applicationId: null,
  serverId: null,
  userCount: null,
  served: [],
  createdAt: now,
  updatedAt: now,
  ...partial,
});

test('graph places the provider to the left of the consumer and keeps UNKNOWN', () => {
  const provider = component({ id: 'db', kind: 'DATABASE', name: 'QR Database' });
  const consumer = component({ id: 'app', kind: 'APPLICATION', name: 'Portal', applicationId: 'app-1' });
  const links: DependencyLink[] = [
    { id: 'hard', fromId: 'app', toId: 'db', type: 'HARD', featureId: null, method: 'DATABASE', notes: 'lookup', createdAt: now, updatedAt: now },
    { id: 'soft', fromId: 'app', toId: 'db', type: 'SOFT', featureId: null, method: null, notes: '', createdAt: now, updatedAt: now },
  ];
  const columns = graphColumns([provider, consumer], links);
  assert.equal(columns.get('db'), 0);
  assert.equal(columns.get('app'), 1);
  assert.equal(liveRegistryStatus(consumer, [{ id: 'app-1', status: 'UNKNOWN' } as Application], []), 'UNKNOWN');

  const html = renderToString(React.createElement(DependencyGraph, {
    registry: [provider, consumer],
    dependencyLinks: links,
    applications: [{ id: 'app-1', status: 'UNKNOWN' } as Application],
    servers: [],
    isDark: false,
    selectedId: null,
    onSelect: () => {},
    simulatedRootId: 'db',
    simulatedAffectedIds: new Set(['app']),
  }));
  assert.match(html, /UNKNOWN/);
  assert.match(html, /SIMULATED/);
  assert.match(html, /DATABASE/);
  assert.match(html, /method not recorded/);
  assert.match(html, /title="QR Database · UNKNOWN"/);
  assert.match(html, /title="Portal · UNKNOWN"/);
  assert.doesNotMatch(html, /title="[^"]*CRITICAL/);
  assert.match(html, /stroke-dasharray="6 5"/);
  assert.match(html, /HARD · DATABASE/);
  assert.match(html, /SOFT · method not recorded/);
  assert.match(html, /provider → consumer/);
});

test('a chosen application keeps only its own relationships', () => {
  const lxp = component({ id: 'lxp', kind: 'APPLICATION', name: 'LXP Portal' });
  const db = component({ id: 'db', kind: 'DATABASE', name: 'Central PostgreSQL Database' });
  const social = component({ id: 'social', kind: 'APPLICATION', name: 'Scholario Social LMS' });
  const pay = component({ id: 'pay', kind: 'THIRD_PARTY_API', name: 'External Payment API' });
  const links: DependencyLink[] = [
    { id: 'lxp-db', fromId: 'lxp', toId: 'db', type: 'HARD', featureId: null, method: 'DATABASE', notes: '', createdAt: now, updatedAt: now },
    { id: 'social-lxp', fromId: 'social', toId: 'lxp', type: 'HARD', featureId: null, method: 'API', notes: '', createdAt: now, updatedAt: now },
    { id: 'web-pay', fromId: 'web', toId: 'pay', type: 'SOFT', featureId: null, method: 'API', notes: '', createdAt: now, updatedAt: now },
  ];
  const picture = directNeighborhood([lxp, db, social, pay], links, 'lxp');
  assert.deepEqual(picture.components.map(item => item.id).sort(), ['db', 'lxp', 'social']);
  assert.deepEqual(picture.links.map(item => item.id).sort(), ['lxp-db', 'social-lxp']);
});

test('an empty register does not invent dependencies', () => {
  const html = renderToString(React.createElement(DependencyGraph, {
    registry: [],
    dependencyLinks: [],
    applications: [],
    servers: [],
    isDark: true,
    selectedId: null,
    onSelect: () => {},
  }));
  assert.match(html, /have not been documented/);
  assert.match(html, /does not mean/);
  assert.doesNotMatch(html, /QR Videos/);
});
