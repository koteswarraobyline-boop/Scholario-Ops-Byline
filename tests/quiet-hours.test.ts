/** Quiet hours (src/lib/quietHours.ts): time zones, overnight windows, weekdays, DST — fixed instants, no clock dependence */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietTime, quietHoursProblem, localClock, isValidTimeZone } from '../src/lib/quietHours.ts';

const q = (start: string, end: string, timezone: string, days?: number[]) => ({ enabled: true, start, end, timezone, days });

test('same-day window in Asia/Kolkata (UTC+5:30, no DST)', () => {
  const office = q('13:00', '14:00', 'Asia/Kolkata');
  assert.equal(isQuietTime(new Date('2026-10-12T07:29:00Z'), office), false, '12:59 IST');
  assert.equal(isQuietTime(new Date('2026-10-12T07:30:00Z'), office), true, '13:00 IST');
  assert.equal(isQuietTime(new Date('2026-10-12T08:29:00Z'), office), true, '13:59 IST');
  assert.equal(isQuietTime(new Date('2026-10-12T08:30:00Z'), office), false, '14:00 IST (end is exclusive)');
});

test('overnight window 22:00 → 07:00, and weekday rules apply to the day the window starts', () => {
  const night = q('22:00', '07:00', 'Asia/Kolkata');
  assert.equal(isQuietTime(new Date('2026-10-12T16:29:00Z'), night), false, '21:59 IST');
  assert.equal(isQuietTime(new Date('2026-10-12T16:30:00Z'), night), true, '22:00 IST');
  assert.equal(isQuietTime(new Date('2026-10-12T20:00:00Z'), night), true, '01:30 IST next day');
  assert.equal(isQuietTime(new Date('2026-10-13T01:29:00Z'), night), true, '06:59 IST');
  assert.equal(isQuietTime(new Date('2026-10-13T01:30:00Z'), night), false, '07:00 IST');

  // Friday night only (5): Fri 23:00 and Sat 03:00 are quiet; Sat 23:00 and Sun 03:00 are not
  const friday = q('22:00', '07:00', 'Asia/Kolkata', [5]);
  assert.equal(isQuietTime(new Date('2026-10-16T17:30:00Z'), friday), true, 'Fri 23:00 IST');
  assert.equal(isQuietTime(new Date('2026-10-16T21:30:00Z'), friday), true, 'Sat 03:00 IST (window started Friday)');
  assert.equal(isQuietTime(new Date('2026-10-17T17:30:00Z'), friday), false, 'Sat 23:00 IST');
  assert.equal(isQuietTime(new Date('2026-10-17T21:30:00Z'), friday), false, 'Sun 03:00 IST');
});

test('DST: Europe/London 22:00 local is 21:00 UTC in summer and 22:00 UTC in winter', () => {
  const london = q('22:00', '07:00', 'Europe/London');
  assert.equal(isQuietTime(new Date('2026-07-01T21:00:00Z'), london), true, 'summer (BST): 22:00 local');
  assert.equal(isQuietTime(new Date('2026-07-01T20:59:00Z'), london), false);
  assert.equal(isQuietTime(new Date('2026-12-01T21:00:00Z'), london), false, 'winter (GMT): only 21:00 local');
  assert.equal(isQuietTime(new Date('2026-12-01T22:00:00Z'), london), true);
  // The night the clocks go back (25 Oct 2026, 02:00 BST → 01:00 GMT) stays quiet throughout
  for (const t of ['2026-10-24T23:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T05:59:00Z']) {
    assert.equal(isQuietTime(new Date(t), london), true, t);
  }
  assert.deepEqual(localClock(new Date('2026-10-25T01:30:00Z'), 'Europe/London'), { day: 0, minute: 90 }, '01:30 GMT after the change');
});

test('disabled / start = end / invalid settings are never quiet; validation explains the problem', () => {
  const at = new Date('2026-10-12T20:00:00Z');
  assert.equal(isQuietTime(at, { ...q('00:00', '23:59', 'UTC'), enabled: false }), false);
  assert.equal(isQuietTime(at, q('09:00', '09:00', 'UTC')), false);
  assert.equal(isQuietTime(at, q('9:00', '17:00', 'UTC')), false);
  assert.equal(isQuietTime(at, null), false);
  assert.match(quietHoursProblem(q('25:00', '07:00', 'UTC'))!, /HH:MM/);
  assert.match(quietHoursProblem(q('22:00', '07:00', 'Mars/Olympus'))!, /Unknown time zone/);
  assert.match(quietHoursProblem(q('22:00', '07:00', 'UTC', [7]))!, /0 \(Sunday\) to 6/);
  assert.equal(quietHoursProblem(q('22:00', '07:00', 'America/New_York', [1, 2, 3])), null);
  assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(isValidTimeZone(''), false);
});
