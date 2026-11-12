import { query, QueryFn, withTransaction } from "./db";
import {
  Frequency,
  addDaysYMD,
  localTodayYMD,
  minYMD,
  nextOccurrenceAfter,
  occurrencesUntil,
  parseYMD,
  periodKey,
} from "./recurring-schedule";

/**
 * Recurring rules book real transactions, one per schedule period (see recurring-schedule.ts).
 *
 * - Generated rows carry `recurring_rule_id` + `recurring_period`. A unique index guarantees at
 *   most one row per rule and period, so concurrent page loads can never create duplicates.
 * - Deleting a generated row records the period in `recurring_skips`, so it is not re-created.
 * - Editing a generated row sets `recurring_modified`; such rows are never rewritten.
 * - Editing a rule rewrites all of its untouched rows (deleted and generated again from the
 *   new settings). Hand-edited rows always stay; only when the frequency changes (so period
 *   keys no longer apply) are they detached and become normal transactions.
 * - Pausing stops booking from the pause date; resuming skips the periods missed while paused.
 * - A rule has ended when its end_date is in the past (no flag needed).
 */

export interface RecurringRuleRow {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  type: "EXPENSE" | "INCOME";
  amount: string;
  description: string;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  is_split: boolean;
  business_share_pct: string;
  business_amount: string;
  active: boolean;
  paused_since: string | null;
}

const RULE_COLUMNS = `
  id,
  user_id,
  account_id,
  category_id,
  type,
  amount::text AS amount,
  description,
  frequency,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  to_char(next_run_date, 'YYYY-MM-DD') AS next_run_date,
  is_split,
  business_share_pct::text AS business_share_pct,
  business_amount::text AS business_amount,
  active,
  to_char(paused_since, 'YYYY-MM-DD') AS paused_since`;

export async function loadRule(
  q: QueryFn,
  ruleId: string,
  userId: string
): Promise<RecurringRuleRow | null> {
  const res = await q<RecurringRuleRow>(
    `SELECT ${RULE_COLUMNS} FROM recurring_rules WHERE id = $1 AND user_id = $2`,
    [ruleId, userId]
  );
  return res.rows[0] ?? null;
}

/** Last date up to which occurrences are booked, or null if nothing should be booked. */
function bookingLimit(rule: RecurringRuleRow, today: string): string | null {
  const pauseLimit = rule.active ? null : addDaysYMD(rule.paused_since || today, -1);
  return minYMD(today, rule.end_date, pauseLimit);
}

async function bookedPeriods(q: QueryFn, rule: RecurringRuleRow): Promise<Set<string>> {
  const res = await q<{ recurring_period: string }>(
    `SELECT recurring_period FROM transactions
     WHERE recurring_rule_id = $1 AND recurring_period IS NOT NULL`,
    [rule.id]
  );
  return new Set(res.rows.map((r) => r.recurring_period));
}

async function skippedPeriods(q: QueryFn, rule: RecurringRuleRow): Promise<Set<string>> {
  const res = await q<{ period: string }>(
    `SELECT period FROM recurring_skips WHERE rule_id = $1`,
    [rule.id]
  );
  return new Set(res.rows.map((r) => r.period));
}

/**
 * Months already covered by transactions imported from an ODS spreadsheet (not linked to the
 * rule), so a monthly rule does not book them a second time.
 */
async function importedMonths(q: QueryFn, rule: RecurringRuleRow): Promise<Set<string>> {
  const months = new Set<string>();
  if (rule.frequency !== "MONTHLY") return months;

  const baseTitle = rule.description.replace(/\s*\([^)]*\)\s*$/, "").trim() || rule.description;
  const res = await q<{ date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date
     FROM transactions
     WHERE user_id = $1
       AND recurring_rule_id IS NULL
       AND notes ILIKE '%Importiert aus ODS%'
       AND account_id = $2
       AND type = $3
       AND amount = $4::numeric
       AND (LOWER(TRIM(description)) = LOWER(TRIM($5)) OR LOWER(TRIM(description)) = LOWER(TRIM($6)))`,
    [rule.user_id, rule.account_id, rule.type, rule.amount, rule.description, baseTitle]
  );

  const anchorDay = parseYMD(rule.start_date).getUTCDate();
  for (const { date } of res.rows) {
    const dt = parseYMD(date);
    // A transfer at the very end of a month for a rule due at the start of the month pays the
    // upcoming month (e.g. 2026-01-31 for February 2026).
    if (anchorDay <= 5 && dt.getUTCDate() >= 25) {
      const next = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
      months.add(next.toISOString().slice(0, 7));
    } else {
      months.add(date.slice(0, 7));
    }
  }
  return months;
}

/** Books all missing occurrences of a rule up to today. Returns the number of rows created. */
export async function syncRule(q: QueryFn, rule: RecurringRuleRow, today = localTodayYMD()): Promise<number> {
  let created = 0;
  const limit = bookingLimit(rule, today);
  const dates = occurrencesUntil(rule.start_date, rule.frequency, limit);

  if (dates.length > 0) {
    const covered = await bookedPeriods(q, rule);
    for (const p of await skippedPeriods(q, rule)) covered.add(p);
    for (const p of await importedMonths(q, rule)) covered.add(p);

    for (const date of dates) {
      const key = periodKey(date, rule.frequency);
      if (covered.has(key)) continue;
      const res = await q(
        `INSERT INTO transactions
          (user_id, account_id, category_id, type, amount, description, notes, date,
           is_split, business_share_pct, business_amount, recurring_rule_id, recurring_period)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (recurring_rule_id, recurring_period)
           WHERE recurring_rule_id IS NOT NULL AND recurring_period IS NOT NULL
         DO NOTHING`,
        [
          rule.user_id,
          rule.account_id,
          rule.category_id,
          rule.type,
          rule.amount,
          rule.description,
          `Auto-generated (${rule.frequency.toLowerCase()} recurring)`,
          date,
          rule.is_split,
          rule.business_share_pct,
          rule.business_amount,
          rule.id,
          key,
        ]
      );
      covered.add(key);
      created += res.rowCount;
    }
  }

  const next = nextOccurrenceAfter(rule.start_date, rule.frequency, today);
  if (next !== rule.next_run_date) {
    await q(`UPDATE recurring_rules SET next_run_date = $1 WHERE id = $2`, [next, rule.id]);
    rule.next_run_date = next;
  }
  return created;
}

export async function processDueRecurringRules(userId: string): Promise<number> {
  const rules = await query<RecurringRuleRow>(
    `SELECT ${RULE_COLUMNS} FROM recurring_rules WHERE user_id = $1`,
    [userId]
  );
  const today = localTodayYMD();
  let created = 0;
  for (const rule of rules.rows) {
    if (!rule.active && !rule.paused_since) continue;
    created += await syncRule(query, rule, today);
  }
  return created;
}

export async function pauseRule(q: QueryFn, rule: RecurringRuleRow, today = localTodayYMD()) {
  if (!rule.active) return;
  await q(`UPDATE recurring_rules SET active = FALSE, paused_since = $1 WHERE id = $2`, [
    today,
    rule.id,
  ]);
  rule.active = false;
  rule.paused_since = today;
}

/** Resumes a paused rule. Periods that fell into the pause are skipped, not booked late. */
export async function resumeRule(q: QueryFn, rule: RecurringRuleRow, today = localTodayYMD()) {
  if (rule.active) return;
  const pausedSince = rule.paused_since || today;
  const gapEnd = minYMD(today, rule.end_date);
  const booked = await bookedPeriods(q, rule);
  for (const date of occurrencesUntil(rule.start_date, rule.frequency, gapEnd)) {
    if (date < pausedSince) continue;
    const key = periodKey(date, rule.frequency);
    if (booked.has(key)) continue;
    await q(
      `INSERT INTO recurring_skips (rule_id, period) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [rule.id, key]
    );
  }
  await q(`UPDATE recurring_rules SET active = TRUE, paused_since = NULL WHERE id = $1`, [rule.id]);
  rule.active = true;
  rule.paused_since = null;
}

export async function setRuleActive(ruleId: string, userId: string, active: boolean): Promise<boolean> {
  return withTransaction(async (q) => {
    const rule = await loadRule(q, ruleId, userId);
    if (!rule) return false;
    if (active) await resumeRule(q, rule);
    else await pauseRule(q, rule);
    await syncRule(q, rule);
    return true;
  });
}

/**
 * Called after a rule's settings were updated: drops its untouched generated rows and books
 * them again from the new settings. `previousFrequency` decides whether period keys (skips and
 * hand-edited rows) still apply.
 */
export async function rewriteRule(
  q: QueryFn,
  rule: RecurringRuleRow,
  previousFrequency: Frequency,
  today = localTodayYMD()
): Promise<number> {
  if (previousFrequency !== rule.frequency) {
    // Period keys of another frequency are meaningless now.
    await q(`DELETE FROM recurring_skips WHERE rule_id = $1`, [rule.id]);
    await q(
      `UPDATE transactions
       SET recurring_rule_id = NULL, recurring_period = NULL, recurring_modified = FALSE
       WHERE recurring_rule_id = $1 AND recurring_modified = TRUE`,
      [rule.id]
    );
  }

  await q(
    `DELETE FROM transactions WHERE recurring_rule_id = $1 AND recurring_modified = FALSE`,
    [rule.id]
  );

  // Hand-edited rows stay linked (even outside a shortened date range), so extending the
  // range again never books their period a second time.
  return syncRule(q, rule, today);
}
