/**
 * Pure date/schedule helpers for recurring rules (no database access).
 *
 * Every occurrence of a rule belongs to exactly one "period":
 *   DAILY   -> "2026-09-14"   (the day)
 *   WEEKLY  -> "2026-W38"     (ISO week)
 *   MONTHLY -> "2026-09"      (the month)
 *   YEARLY  -> "2026"         (the year)
 * A schedule never has two occurrences in the same period, so the period key identifies an
 * occurrence even if the rule's start day changes (e.g. from the 1st to the 15th of the month).
 */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export const FREQUENCIES: Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

const MAX_OCCURRENCES = 100_000;

export function parseYMD(value: string): Date {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidYMD(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return formatYMD(parseYMD(value)) === value;
}

/** Today's date (YYYY-MM-DD) in the server's local timezone (set via the TZ env variable). */
export function localTodayYMD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysYMD(value: string, days: number): string {
  const d = parseYMD(value);
  d.setUTCDate(d.getUTCDate() + days);
  return formatYMD(d);
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function isoWeekKey(value: string): string {
  const d = parseYMD(value);
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function periodKey(date: string, frequency: Frequency): string {
  const ymd = String(date).slice(0, 10);
  switch (frequency) {
    case "DAILY":
      return ymd;
    case "WEEKLY":
      return isoWeekKey(ymd);
    case "MONTHLY":
      return ymd.slice(0, 7);
    case "YEARLY":
      return ymd.slice(0, 4);
  }
}

/** The n-th occurrence (0-based) of a schedule, computed from the start date to avoid drift. */
export function nthOccurrence(start: string, frequency: Frequency, n: number): string {
  const s = parseYMD(start);
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth();
  const d = s.getUTCDate();
  switch (frequency) {
    case "DAILY":
      return formatYMD(new Date(Date.UTC(y, m, d + n)));
    case "WEEKLY":
      return formatYMD(new Date(Date.UTC(y, m, d + 7 * n)));
    case "MONTHLY": {
      const ty = y + Math.floor((m + n) / 12);
      const tm = (m + n) % 12;
      return formatYMD(new Date(Date.UTC(ty, tm, Math.min(d, daysInMonth(ty, tm)))));
    }
    case "YEARLY": {
      const ty = y + n;
      return formatYMD(new Date(Date.UTC(ty, m, Math.min(d, daysInMonth(ty, m)))));
    }
  }
}

/** All occurrence dates from `start` up to and including `until` (empty if until < start). */
export function occurrencesUntil(start: string, frequency: Frequency, until: string | null): string[] {
  const result: string[] = [];
  if (!until || until < start) return result;
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const date = nthOccurrence(start, frequency, n);
    if (date > until) break;
    result.push(date);
  }
  return result;
}

/** First occurrence strictly after `after`. */
export function nextOccurrenceAfter(start: string, frequency: Frequency, after: string): string {
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const date = nthOccurrence(start, frequency, n);
    if (date > after) return date;
  }
  return nthOccurrence(start, frequency, MAX_OCCURRENCES);
}

export function minYMD(...values: (string | null | undefined)[]): string | null {
  const present = values.filter((v): v is string => Boolean(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => (a < b ? a : b));
}
