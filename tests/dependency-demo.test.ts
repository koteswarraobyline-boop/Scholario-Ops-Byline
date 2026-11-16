/**
 * Demo dependency picture. No database and no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_APP_NAMES,
  DEMO_SCENARIOS,
  demoComponents,
  demoDependencyLinks,
  demoIncident,
  demoNameById,
  simulateDemoFailure,
} from '../src/mocks/dependencyDemoData.ts';

const TABLE = [
  ['QR Videos', 'LXP Portal', 'SOFT', 'API'],
  ['QR Videos', 'Scholario Social LMS', 'SOFT', 'API'],
  ['Scholario Social LMS', 'LXP Portal', 'HARD', 'DATABASE'],
  ['Scholario Ascend', 'LXP Portal', 'HARD', 'API'],
  ['Scholario Ascend', 'Scholario Social LMS', 'SOFT', 'API'],
  ['Vantage', 'LXP Portal', 'HARD', 'API'],
  ['Vantage', 'Scholario KG LMS', 'SOFT', 'DATABASE'],
  ['Scholario Lumo', 'LXP Portal', 'HARD', 'API'],
  ['Scholario Lumo', 'Scholario Websites', 'SOFT', 'EMBED'],
  ['Scholario KG LMS', 'LXP Portal', 'HARD', 'API'],
  ['Scholario KG LMS', 'Scholario Websites', 'SOFT', 'HTTP'],
  ['ICT (Cipher LMS)', 'LXP Portal', 'SOFT', 'API'],
  ['Scholario Websites', 'LXP Portal', 'SOFT', 'API'],
] as const;

test('the demo lists the nine applications and the named relationships', () => {
  assert.equal(DEMO_APP_NAMES.length, 9);
  const names = new Set(demoComponents().filter(item => item.kind === 'APPLICATION').map(item => item.name));
  for (const name of DEMO_APP_NAMES) assert.equal(names.has(name), true);
  const links = demoDependencyLinks();
  for (const [consumer, provider, type, method] of TABLE) {
    const row = links.find(link => demoNameById(link.fromId) === consumer && demoNameById(link.toId) === provider);
    assert.ok(row, `${consumer} → ${provider}`);
    assert.equal(row.type, type);
    assert.equal(row.method, method);
    assert.equal(row.fromId !== row.toId, true);
  }
  assert.equal(demoComponents().every(item => item.applicationId === null && item.serverId === null), true);
});

test('failure walks provider to consumer and leaves unrelated nodes UNKNOWN', () => {
  const lxp = simulateDemoFailure('LXP Portal');
  assert.ok(lxp);
  const social = lxp.direct.find(row => row.name === 'Scholario Social LMS');
  const qr = lxp.direct.find(row => row.name === 'QR Videos');
  assert.equal(social?.via, 'HARD');
  assert.equal(qr?.via, 'SOFT');
  assert.equal(lxp.visual.get('demo-pay'), undefined);

  const database = simulateDemoFailure('Central PostgreSQL Database');
  assert.ok(database);
  assert.equal(database.direct.some(row => row.name === 'LXP Portal' && row.via === 'HARD'), true);
  assert.equal(database.indirect.some(row => row.name === 'QR Videos' && row.via === 'SOFT'), true);

  const storage = simulateDemoFailure('Shared Object Storage');
  assert.equal(storage?.direct.some(row => row.name === 'QR Videos' && row.via === 'HARD'), true);
  assert.equal(storage?.visual.get('demo-lxp'), undefined);

  const again = simulateDemoFailure('LXP Portal');
  assert.equal(again?.direct.length, lxp.direct.length);
});

test('a demo incident is labelled and does not call the network', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => { called = true; return Promise.reject(new Error('demo must not fetch')); }) as typeof fetch;
  const incident = demoIncident(DEMO_SCENARIOS[0]);
  assert.ok(incident);
  assert.match(incident.id, /^DEMO-/);
  assert.match(incident.recovery, /does not close/);
  assert.equal(called, false);
  globalThis.fetch = original;
});
