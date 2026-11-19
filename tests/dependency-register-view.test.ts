/**
 * Dependency Register listing: consumer and provider application fields,
 * Hard/Soft, feature name, search, application filter, and sort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_NOT_LIMITED,
  dependencyRegisterRows,
  dependencyTypeFilter,
  featureLabel,
  filterDependencyRegister,
  partyHeading,
  partyMeta,
  registerLiveKey,
  sortDependencyRegister,
} from '../src/lib/dependencyRegister.ts';
import type { DependencyLink, RegistryComponent } from '../src/types/index.ts';

const component = (patch: Partial<RegistryComponent> & Pick<RegistryComponent, 'id' | 'kind' | 'name'>): RegistryComponent => ({
  owner: 'Owner', tier: 'TIER_1', description: '', applicationId: null, serverId: null,
  userCount: null, served: [], endpoint: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const link = (patch: Partial<DependencyLink> & Pick<DependencyLink, 'id' | 'fromId' | 'toId'>): DependencyLink => ({
  type: 'HARD', featureId: null, method: null, criticality: null, healthCheck: '', failureBehaviour: '',
  owner: '', recoveryExpectation: '', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const portal = component({ id: 'lp', kind: 'APPLICATION', name: 'Learning Platform', applicationId: 'app-lp', owner: 'Academic IT' });
const exams = component({ id: 'exams', kind: 'APPLICATION', name: 'Exams', applicationId: 'app-exams' });
const db = component({ id: 'db', kind: 'DATABASE', name: 'Student DB', owner: 'DBA team', endpoint: 'db.internal' });
const tutor = component({ id: 'tutor', kind: 'BUSINESS_FEATURE', name: 'AI Tutor', applicationId: 'app-lp' });
const apps = [
  { id: 'app-lp', name: 'Learning Platform', codeName: 'lms', tier: 'TIER_1' as const, status: 'HEALTHY' as const },
  { id: 'app-exams', name: 'Online Exams', codeName: 'exams', tier: 'TIER_2' as const, status: 'WARNING' as const },
];

test('a link shows the consumer application, the provider, the type, and the feature', () => {
  const [row] = dependencyRegisterRows(
    [link({ id: 'out-ai', fromId: 'lp', toId: 'exams', type: 'SOFT', featureId: 'tutor', method: 'API', notes: 'tutor calls exams' })],
    [portal, exams, db, tutor],
    apps,
  );
  assert.equal(partyHeading(row.consumer), 'Learning Platform');
  assert.deepEqual(partyMeta(row.consumer), ['lms · Tier 1 · HEALTHY']);
  assert.equal(row.consumer.applicationId, 'app-lp');
  assert.equal(partyHeading(row.provider), 'Online Exams');
  assert.deepEqual(partyMeta(row.provider), ['exams · Tier 2 · WARNING']);
  assert.equal(row.type, 'SOFT');
  assert.equal(featureLabel(row), 'AI Tutor');
  assert.equal(row.method, 'API');
});

test('a provider with no application stays a register entry, and a missing feature stays unnamed', () => {
  const [row] = dependencyRegisterRows(
    [link({ id: 'out-db', fromId: 'lp', toId: 'db', method: 'DATABASE' })],
    [portal, db],
    apps,
  );
  assert.equal(row.provider.applicationId, null);
  assert.equal(partyHeading(row.provider), 'Student DB');
  assert.deepEqual(partyMeta(row.provider), ['Database · DBA team', 'db.internal', 'No application record']);
  assert.equal(featureLabel(row), FEATURE_NOT_LIMITED);
});

test('a feature used as the consumer still names its application', () => {
  const [row] = dependencyRegisterRows(
    [link({ id: 'feat', fromId: 'tutor', toId: 'db', type: 'HARD' })],
    [portal, tutor, db],
    apps,
  );
  assert.equal(partyHeading(row.consumer), 'Learning Platform');
  assert.deepEqual(partyMeta(row.consumer), ['lms · Tier 1 · HEALTHY', 'Business feature · AI Tutor']);
  assert.equal(featureLabel(row), 'AI Tutor');
  assert.deepEqual(filterDependencyRegister([row], { query: 'stops', type: 'ALL', applicationId: '' }).map(item => item.id), ['feat']);
  const [soft] = dependencyRegisterRows(
    [link({ id: 'soft-feat', fromId: 'tutor', toId: 'db', type: 'SOFT' })],
    [portal, tutor, db],
    apps,
  );
  assert.equal(featureLabel(soft), 'AI Tutor');
  assert.deepEqual(filterDependencyRegister([soft], { query: 'feature stops', type: 'ALL', applicationId: '' }).map(item => item.id), ['soft-feat']);
  assert.deepEqual(filterDependencyRegister([soft], { query: 'keeps running', type: 'ALL', applicationId: '' }).map(item => item.id), []);
});

test('an unknown end is marked missing and does not invent an application', () => {
  const [row] = dependencyRegisterRows([link({ id: 'gone', fromId: 'missing', toId: 'db' })], [db], apps);
  assert.equal(row.consumer.missing, true);
  assert.equal(partyHeading(row.consumer), 'Unknown');
  assert.deepEqual(partyMeta(row.consumer), ['Not in the register']);
  assert.equal(row.consumer.applicationId, null);
});

test('search, type, and application filters narrow the listing', () => {
  const rows = dependencyRegisterRows(
    [
      link({ id: 'hard-db', fromId: 'lp', toId: 'db', type: 'HARD', method: 'DATABASE', notes: 'login' }),
      link({ id: 'soft-exams', fromId: 'lp', toId: 'exams', type: 'SOFT', featureId: 'tutor', method: 'API' }),
      link({ id: 'incoming', fromId: 'exams', toId: 'lp', type: 'SOFT' }),
    ],
    [portal, exams, db, tutor],
    apps,
  );
  assert.deepEqual(filterDependencyRegister(rows, { query: 'lms', type: 'ALL', applicationId: '' }).map(row => row.id), ['hard-db', 'soft-exams', 'incoming']);
  assert.deepEqual(filterDependencyRegister(rows, { query: 'AI Tutor', type: 'ALL', applicationId: '' }).map(row => row.id), ['soft-exams']);
  assert.deepEqual(filterDependencyRegister(rows, { query: '', type: 'HARD', applicationId: '' }).map(row => row.id), ['hard-db']);
  assert.deepEqual(filterDependencyRegister(rows, { query: 'student', type: 'ALL', applicationId: 'app-exams' }).map(row => row.id), []);
  assert.deepEqual(
    filterDependencyRegister(rows, { query: '', type: 'SOFT', applicationId: 'app-exams' }).map(row => row.id),
    ['soft-exams', 'incoming'],
  );
});

test('search includes criticality, owner, and what users see', () => {
  const rows = dependencyRegisterRows(
    [link({
      id: 'owned', fromId: 'lp', toId: 'db', type: 'HARD', criticality: 'CRITICAL',
      owner: 'DBA team', failureBehaviour: 'Login stops', healthCheck: 'SELECT 1', recoveryExpectation: 'Restore the primary',
    })],
    [portal, db],
    apps,
  );
  for (const query of ['CRITICAL', 'DBA team', 'Login stops', 'SELECT 1', 'Restore the primary']) {
    assert.deepEqual(filterDependencyRegister(rows, { query, type: 'ALL', applicationId: '' }).map(row => row.id), ['owned']);
  }
});

test('a type query accepts only Hard and Soft', () => {
  assert.equal(dependencyTypeFilter('HARD'), 'HARD');
  assert.equal(dependencyTypeFilter('SOFT'), 'SOFT');
  assert.equal(dependencyTypeFilter('MAYBE'), 'ALL');
  assert.equal(dependencyTypeFilter(null), 'ALL');
});

test('the live key ignores order and changes when a link is edited', () => {
  const saved = link({ id: 'hard-db', fromId: 'lp', toId: 'db', type: 'HARD' });
  const edited = link({ id: 'hard-db', fromId: 'lp', toId: 'db', type: 'SOFT' });
  assert.equal(registerLiveKey([saved, link({ id: 'b', fromId: 'exams', toId: 'lp' })], [portal, db]), registerLiveKey([link({ id: 'b', fromId: 'exams', toId: 'lp' }), saved], [db, portal]));
  assert.notEqual(registerLiveKey([saved], [portal]), registerLiveKey([edited], [portal]));
});

test('sorting is by consumer, provider, type, feature, or method, with a stable tie-break', () => {
  const rows = dependencyRegisterRows(
    [
      link({ id: 'b', fromId: 'exams', toId: 'db', type: 'SOFT' }),
      link({ id: 'a', fromId: 'lp', toId: 'exams', type: 'HARD', featureId: 'tutor' }),
      link({ id: 'c', fromId: 'lp', toId: 'db', type: 'HARD' }),
    ],
    [portal, exams, db, tutor],
    apps,
  );
  assert.deepEqual(sortDependencyRegister(rows, 'consumer', 'asc').map(row => row.id), ['a', 'c', 'b']);
  assert.deepEqual(sortDependencyRegister(rows, 'provider', 'desc').map(row => row.id), ['c', 'b', 'a']);
  assert.deepEqual(sortDependencyRegister(rows, 'type', 'asc').map(row => row.id), ['a', 'c', 'b']);
  assert.deepEqual(sortDependencyRegister(rows, 'feature', 'asc').map(row => row.id), ['a', 'c', 'b']);
  const withMethod = dependencyRegisterRows(
    [
      link({ id: 'db', fromId: 'lp', toId: 'db', method: 'DATABASE' }),
      link({ id: 'api', fromId: 'lp', toId: 'exams', method: 'API' }),
      link({ id: 'blank', fromId: 'exams', toId: 'lp' }),
    ],
    [portal, exams, db],
    apps,
  );
  assert.deepEqual(sortDependencyRegister(withMethod, 'method', 'asc').map(row => row.id), ['api', 'db', 'blank']);
});
