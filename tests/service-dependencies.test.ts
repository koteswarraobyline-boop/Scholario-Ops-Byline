import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyFeatureAllowed, projectServiceDependencies, providerBlockedForFeature, registryLiveStatus, wholeApplicationLinks } from '../src/lib/serviceDependencies.ts';
import { databaseSuggestions } from '../src/lib/dependencySuggestions.ts';
import type { DependencyLink, RegistryComponent } from '../src/types/index.ts';

const component = (patch: Partial<RegistryComponent> & Pick<RegistryComponent, 'id' | 'kind' | 'name'>): RegistryComponent => ({
  owner: 'Owner', tier: 'TIER_1', description: '', applicationId: null, serverId: null,
  userCount: null, served: [], endpoint: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const link = (patch: Partial<DependencyLink> & Pick<DependencyLink, 'id' | 'fromId' | 'toId'>): DependencyLink => ({
  type: 'HARD', featureId: null, method: null, criticality: null, healthCheck: '', failureBehaviour: '', owner: '', recoveryExpectation: '', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const portal = component({ id: 'lp', kind: 'APPLICATION', name: 'Learning Platform', applicationId: 'app-lp' });
const exams = component({ id: 'exams', kind: 'APPLICATION', name: 'Exams', applicationId: 'app-exams' });
const db = component({ id: 'db', kind: 'DATABASE', name: 'Student DB' });
const tutor = component({ id: 'tutor', kind: 'BUSINESS_FEATURE', name: 'AI Tutor', applicationId: 'app-lp' });
const otherFeature = component({ id: 'uploads', kind: 'BUSINESS_FEATURE', name: 'Uploads', applicationId: 'app-exams' });
const loose = component({ id: 'loose', kind: 'BUSINESS_FEATURE', name: 'Loose feature' });
const server = component({ id: 'srv', kind: 'SERVER', name: 'prd-1', serverId: 'server-1' });

test('an application record lists the same outgoing and incoming register links the API returns', () => {
  const view = projectServiceDependencies('app-lp', {
    applications: [
      { id: 'app-lp', status: 'STALE' },
      { id: 'app-exams', status: 'CRITICAL' },
    ],
    servers: [{ id: 'server-1', status: 'HEALTHY' }],
    registry: [portal, exams, db, tutor, otherFeature, server],
    links: [
      link({ id: 'out-db', fromId: 'lp', toId: 'db', method: 'DATABASE', notes: 'login' }),
      link({ id: 'out-ai', fromId: 'lp', toId: 'exams', type: 'SOFT', featureId: 'tutor', method: 'API' }),
      link({ id: 'in', fromId: 'exams', toId: 'lp', type: 'SOFT' }),
      link({ id: 'elsewhere', fromId: 'exams', toId: 'db' }),
    ],
  });
  assert.equal(view.applicationId, 'app-lp');
  assert.equal(view.componentId, 'lp');
  assert.deepEqual(view.outgoing.map(l => l.id), ['out-db', 'out-ai']);
  assert.equal(view.outgoing[0].otherKind, 'DATABASE');
  assert.equal(view.outgoing[0].otherApplicationId, null);
  assert.equal(view.outgoing[0].status, 'UNKNOWN');
  assert.equal(view.outgoing[1].featureName, 'AI Tutor');
  assert.equal(view.features.find(f => f.id === 'tutor')?.uses.some(l => l.id === 'out-ai'), true);
  assert.equal(view.features.find(f => f.id === 'uploads'), undefined);
  assert.equal(view.outgoing[1].otherApplicationId, 'app-exams');
  assert.equal(view.outgoing[1].status, 'CRITICAL');
  assert.deepEqual(view.applicationLevel.map(l => l.id), ['out-db']);
  assert.deepEqual(wholeApplicationLinks(view).map(l => l.id), ['out-db']);
  assert.deepEqual(view.incoming.map(l => [l.otherName, l.status]), [['Exams', 'CRITICAL']]);
  assert.equal(registryLiveStatus(portal, [{ id: 'app-lp', status: 'STALE' }], []), 'WARNING');
  assert.equal(registryLiveStatus(server, [], [{ id: 'server-1', status: 'STALE' }]), 'WARNING');
});

test('a Hard feature link changes the application, and a Soft feature link does not', () => {
  const view = projectServiceDependencies('app-lp', {
    applications: [{ id: 'app-lp', status: 'HEALTHY' }],
    servers: [],
    registry: [portal, db, tutor],
    links: [
      link({ id: 'soft-feature', fromId: 'lp', toId: 'db', type: 'SOFT', featureId: 'tutor' }),
      link({ id: 'hard-feature', fromId: 'tutor', toId: 'db', type: 'HARD' }),
      link({ id: 'soft-from-feature', fromId: 'tutor', toId: 'db', type: 'SOFT', featureId: null }),
    ],
  });
  assert.deepEqual(view.applicationLevel.map(l => l.id), ['hard-feature']);
});

test('an application with no register row has an empty dependency view', () => {
  const view = projectServiceDependencies('missing', {
    applications: [], servers: [], registry: [portal], links: [link({ id: 'x', fromId: 'lp', toId: 'db' })],
  });
  assert.equal(view.componentId, null);
  assert.deepEqual(view.outgoing, []);
  assert.deepEqual(view.incoming, []);
});

test('a saved database name is suggested until the owner records or dismisses it', () => {
  const app = { id: 'app-lp', prdServerId: 'server-1', drServerId: null, environments: { PRD: { appPort: null, healthPath: null, webServer: null, processManager: null, routing: null, dbEngine: 'postgresql' as const, dbName: 'lxp', dbPort: 5432, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' } } };
  const servers = [{ id: 'server-1', hostname: 'db.internal' }];
  const open = databaseSuggestions({ app, servers, registry: [portal], links: [], dismissed: [] });
  assert.equal(open.length, 1);
  assert.equal(open[0].name, 'postgresql lxp');
  assert.equal(open[0].endpoint, 'db.internal 5432 lxp');
  assert.equal(databaseSuggestions({ app, servers, registry: [portal], links: [], dismissed: [open[0].key] }).length, 0);
  const recorded = databaseSuggestions({
    app, servers,
    registry: [portal, component({ id: 'db', kind: 'DATABASE', name: 'postgresql lxp' })],
    links: [link({ id: 'have', fromId: 'lp', toId: 'db' })],
    dismissed: [],
  });
  assert.equal(recorded.length, 0);
});

test('a feature is offered only when it belongs to the consumer application', () => {
  assert.equal(dependencyFeatureAllowed(tutor, portal), true);
  assert.equal(dependencyFeatureAllowed(otherFeature, portal), false);
  assert.equal(dependencyFeatureAllowed(loose, portal), false);
  assert.equal(dependencyFeatureAllowed(loose, component({ id: 'free', kind: 'DATABASE', name: 'Free' })), true);
  assert.equal(dependencyFeatureAllowed(db, portal), false);
});

test('the same provider can be recorded again for a different feature', () => {
  const links = [
    link({ id: 'whole', fromId: 'lp', toId: 'db', featureId: null }),
    link({ id: 'tutor-db', fromId: 'lp', toId: 'db', featureId: 'tutor' }),
  ];
  assert.equal(providerBlockedForFeature(links, 'db', null), true);
  assert.equal(providerBlockedForFeature(links, 'db', 'tutor'), true);
  assert.equal(providerBlockedForFeature(links, 'db', 'uploads'), false);
  assert.equal(providerBlockedForFeature(links, 'db', 'new'), false);
  assert.equal(providerBlockedForFeature(links, 'media', null), false);
});
