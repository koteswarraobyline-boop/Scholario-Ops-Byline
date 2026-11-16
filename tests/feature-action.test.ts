/**
 * Feature action text from a dependency. No database.
 *   npm run test:local -- tests/feature-action.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureAction } from '../src/lib/featureAction.ts';

test('a hard dependency says the feature stopped and names what to restore', () => {
  const action = featureAction('Enrolment', 'HARD', 'Impact DB');
  assert.match(action, /^Stopped\./);
  assert.match(action, /Restore Impact DB/);
  assert.match(action, /Enrolment cannot run without it/);
});

test('a soft dependency says the feature is degraded until the dependency recovers', () => {
  const action = featureAction('AI Tutor', 'SOFT', 'OpenAI API');
  assert.match(action, /^Degraded\./);
  assert.match(action, /AI Tutor still runs with reduced function/);
  assert.match(action, /until OpenAI API recovers/);
});

test('a feature that is itself the failure still names the restore action', () => {
  assert.match(featureAction('Enrolment', 'HARD', 'Enrolment'), /Restore Enrolment/);
  assert.match(featureAction('Enrolment', 'SOFT', 'Enrolment'), /only partly available/);
});
