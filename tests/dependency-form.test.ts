/**
 * Add and edit dependency form checks: applications, Hard/Soft, method,
 * feature name, failure behaviour, rationale, duplicates, and deletion rules
 * that the form enforces before the API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankDependencyForm,
  dependencyFormFromLink,
  formKeepsStoredEnds,
  validateDependencyForm,
  type DependencyFormContext,
  type DependencyFormValues,
} from '../src/lib/dependencyForm.ts';

const registry = [
  { id: 'lp', kind: 'APPLICATION' as const, name: 'Learning Platform', applicationId: 'app-lp', serverId: null },
  { id: 'exams', kind: 'APPLICATION' as const, name: 'Exams', applicationId: 'app-exams', serverId: null },
  { id: 'db', kind: 'DATABASE' as const, name: 'Student DB', applicationId: null, serverId: null },
  { id: 'tutor', kind: 'BUSINESS_FEATURE' as const, name: 'AI Tutor', applicationId: 'app-lp', serverId: null },
  { id: 'other-feature', kind: 'BUSINESS_FEATURE' as const, name: 'Marking', applicationId: 'app-exams', serverId: null },
  { id: 'prd', kind: 'SERVER' as const, name: 'prd-1', applicationId: null, serverId: 'srv-prd' },
];

const ctx: DependencyFormContext = {
  applications: [
    { id: 'app-lp', name: 'Learning Platform', prdServerId: 'srv-prd', drServerId: 'srv-dr' },
    { id: 'app-exams', name: 'Exams', prdServerId: 'srv-prd-exams', drServerId: null },
  ],
  registry,
  links: [
    { id: 'link-1', fromId: 'lp', toId: 'exams', featureId: null },
    { id: 'link-2', fromId: 'lp', toId: 'db', featureId: 'tutor' },
  ],
  editingId: null,
};

const valid = (patch: Partial<DependencyFormValues> = {}): DependencyFormValues => ({
  ...blankDependencyForm('app-lp'),
  providerKey: 'app:app-exams',
  type: 'HARD',
  method: 'API',
  failureBehaviour: 'Sign-in shows an error and stops',
  rationale: 'Exams reads the learner record',
  ...patch,
});

test('a complete Hard dependency is accepted when this pair is not already recorded', () => {
  assert.deepEqual(validateDependencyForm(valid({ providerKey: 'cmp:db' }), ctx), {});
});

test('the same consumer, provider, and feature cannot be saved twice', () => {
  const errors = validateDependencyForm(valid(), ctx);
  assert.equal(errors.providerKey, '"Learning Platform" already depends on "Exams"');
});

test('consumer and provider are required, and an application cannot depend on itself', () => {
  const missing = validateDependencyForm(blankDependencyForm(), ctx);
  assert.equal(missing.consumerKey, 'Choose the consumer application.');
  assert.equal(missing.providerKey, 'Choose the provider.');
  const self = validateDependencyForm(valid({ providerKey: 'app:app-lp' }), ctx);
  assert.equal(self.providerKey, 'An application cannot depend on itself.');
});

test('type and method must be one of the register values', () => {
  const badType = validateDependencyForm(valid({ type: '' }), ctx);
  assert.equal(badType.type, 'Type must be Hard or Soft.');
  const badMethod = validateDependencyForm(valid({ method: 'FTP' as DependencyFormValues['method'] }), ctx);
  assert.match(badMethod.method ?? '', /HTTP, API, DATABASE, EMBED, LINK, OTHER/);
  assert.deepEqual(validateDependencyForm(valid({ method: '' }), ctx).method, undefined);
});

test('a new feature name is required, and a feature of another application is rejected', () => {
  const missing = validateDependencyForm(valid({ featureChoice: 'new', featureName: '  ' }), ctx);
  assert.equal(missing.featureName, 'Feature name is required');
  const foreign = validateDependencyForm(valid({ featureChoice: 'other-feature' }), ctx);
  assert.equal(foreign.featureChoice, 'The feature must belong to the consumer application');
  const own = validateDependencyForm(valid({ featureChoice: 'tutor', providerKey: 'cmp:db' }), ctx);
  assert.equal(own.providerKey, '"Learning Platform" already depends on "Student DB" for that feature');
});

test('a brand-new feature name is not treated as the whole-consumer link', () => {
  const errors = validateDependencyForm(valid({
    providerKey: 'app:app-exams',
    featureChoice: 'new',
    featureName: 'Sign-in',
    type: 'SOFT',
  }), ctx);
  assert.deepEqual(errors, {});
});

test('reusing a feature name that already has this provider is a duplicate', () => {
  const errors = validateDependencyForm(valid({
    providerKey: 'cmp:db',
    featureChoice: 'new',
    featureName: 'ai tutor',
  }), ctx);
  assert.equal(errors.providerKey, '"Learning Platform" already depends on "Student DB" for that feature');
});

test('editing the same link is not a duplicate of itself', () => {
  const errors = validateDependencyForm(valid(), { ...ctx, editingId: 'link-1' });
  assert.deepEqual(errors, {});
});

test('failure behaviour and rationale reject secrets and over-long text', () => {
  const secret = validateDependencyForm(valid({
    failureBehaviour: 'token=abc',
    rationale: 'see https://user:pass@db.internal/path',
  }), ctx);
  assert.match(secret.failureBehaviour ?? '', /must not include a password or token/);
  assert.match(secret.rationale ?? '', /must not include a password or token/);
  const long = validateDependencyForm(valid({ failureBehaviour: 'x'.repeat(501), rationale: 'y'.repeat(501) }), ctx);
  assert.equal(long.failureBehaviour, 'Failure behaviour must be at most 500 characters');
  assert.equal(long.rationale, 'Rationale must be at most 500 characters');
});

test('the consumer production server is hosting, not a dependency', () => {
  const errors = validateDependencyForm(valid({ providerKey: 'cmp:prd' }), ctx);
  assert.match(errors.providerKey ?? '', /Hosting is recorded on the application/);
  assert.match(errors.providerKey ?? '', /production server/);
});

test('editing keeps a feature-sized link on that feature until the ends change', () => {
  const stored = {
    fromId: 'tutor',
    toId: 'db',
    type: 'SOFT' as const,
    method: 'HTTP' as const,
    featureId: null,
    failureBehaviour: 'Tutor pauses',
    notes: 'Tutor calls the model',
  };
  const values = dependencyFormFromLink(stored, registry);
  assert.equal(formKeepsStoredEnds(values, stored, registry), true);
  assert.equal(formKeepsStoredEnds({ ...values, rationale: 'Updated reason' }, stored, registry), true);
  assert.equal(formKeepsStoredEnds({ ...values, featureChoice: '' }, stored, registry), false);
  const errors = validateDependencyForm(values, {
    ...ctx,
    editingId: 'feat-link',
    storedLink: stored,
    links: [...ctx.links, { id: 'other', fromId: 'lp', toId: 'db', featureId: 'tutor' }],
  });
  assert.deepEqual(errors, {});
  const widened = validateDependencyForm({ ...values, featureChoice: '' }, {
    ...ctx,
    editingId: 'feat-link',
    storedLink: stored,
  });
  assert.equal(widened.providerKey, undefined);
});

test('edit starts from the consumer application, provider, feature, failure behaviour, and rationale', () => {
  const values = dependencyFormFromLink({
    fromId: 'tutor',
    toId: 'db',
    type: 'SOFT',
    method: 'HTTP',
    featureId: null,
    failureBehaviour: 'Tutor pauses',
    notes: 'Tutor calls the model',
  }, registry);
  assert.equal(values.consumerKey, 'app:app-lp');
  assert.equal(values.providerKey, 'cmp:db');
  assert.equal(values.featureChoice, 'tutor');
  assert.equal(values.type, 'SOFT');
  assert.equal(values.method, 'HTTP');
  assert.equal(values.failureBehaviour, 'Tutor pauses');
  assert.equal(values.rationale, 'Tutor calls the model');
});
