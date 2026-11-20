/**
 * Quiet hours of an escalation policy, evaluated in an explicit IANA time zone (DST-safe: the local
 * wall-clock time is computed for that zone at every check). Pure, shared by the server and the UI.
 *
 *   { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata', days: [1,2,3,4,5] }
 *
 * start > end is an overnight window (22:00 → 07:00 next morning). `days` (0 = Sunday … 6) limits the
 * window to the days on which it STARTS; omitted or empty = every day. start === end = never quiet.
 */
export interface QuietHours {
  enabled: boolean;
  /** "HH:MM" 24 h, local time in `timezone` */
  start: string;
  end: string;
  /** IANA zone, e.g. "Asia/Kolkata", "Europe/London" */
  timezone: string;
  days?: number[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (hhmm: string) => { const m = HHMM.exec(hhmm)!; return Number(m[1]) * 60 + Number(m[2]); };

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Reason the settings are invalid, or null */
export function quietHoursProblem(q: QuietHours): string | null {
  if (!HHMM.test(q.start) || !HHMM.test(q.end)) return 'Quiet hours need start and end as HH:MM (24 h)';
  if (!isValidTimeZone(q.timezone)) return `Unknown time zone "${q.timezone}" (use an IANA name such as Asia/Kolkata)`;
  if (q.days && (!Array.isArray(q.days) || q.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return 'Quiet-hours days must be 0 (Sunday) to 6 (Saturday)';
  return null;
}

/** Local weekday (0–6) and minute of the day of `at` in `tz` */
export function localClock(at: Date, tz: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isQuietTime(at: Date, q: QuietHours | undefined | null): boolean {
  if (!q?.enabled || quietHoursProblem(q)) return false;
  const start = toMin(q.start), end = toMin(q.end);
  if (start === end) return false;
  const { day, minute } = localClock(at, q.timezone);
  const dayOk = (d: number) => !q.days?.length || q.days.includes(d);
  if (start < end) return minute >= start && minute < end && dayOk(day);
  // Overnight: the evening part belongs to today, the morning part to the window that started yesterday
  if (minute >= start) return dayOk(day);
  if (minute < end) return dayOk((day + 6) % 7);
  return false;
}

/** "07:00 Asia/Kolkata" — when the current quiet period ends, for messages */
export const quietUntil = (q: QuietHours) => `${q.end} ${q.timezone}`;
