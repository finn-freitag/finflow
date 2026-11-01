import { query } from "./db";

interface RecurringRuleRow {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  type: "EXPENSE" | "INCOME";
  amount: string;
  description: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  next_run_date: string | Date;
  is_split: boolean;
  business_share_pct: string;
  business_amount: string;
  active: boolean;
}

function formatDateYMD(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseYMD(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const str = String(value).slice(0, 10);
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function advanceDate(date: Date, frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"): Date {
  const next = new Date(date.getTime());
  if (frequency === "DAILY") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (frequency === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (frequency === "MONTHLY") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else if (frequency === "YEARLY") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return next;
}

export async function processDueRecurringRules(userId: string): Promise<number> {
  const todayStr = formatDateYMD(new Date());
  const todayDate = parseYMD(todayStr);

  const rulesRes = await query<RecurringRuleRow>(
    `SELECT * FROM recurring_rules WHERE user_id = $1 AND active = TRUE AND next_run_date <= $2`,
    [userId, todayStr]
  );

  let createdCount = 0;

  for (const rule of rulesRes.rows) {
    let runDate = parseYMD(rule.next_run_date);
    let safetyCounter = 0;

    while (runDate.getTime() <= todayDate.getTime() && safetyCounter < 36) {
      const dateStr = formatDateYMD(runDate);
      await query(
        `INSERT INTO transactions
          (user_id, account_id, category_id, type, amount, description, notes, date, is_split, business_share_pct, business_amount, recurring_rule_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId,
          rule.account_id,
          rule.category_id,
          rule.type,
          rule.amount,
          rule.description,
          `Auto-generated (${rule.frequency.toLowerCase()} recurring)`,
          dateStr,
          rule.is_split,
          rule.business_share_pct,
          rule.business_amount,
          rule.id,
        ]
      );
      createdCount++;
      safetyCounter++;
      runDate = advanceDate(runDate, rule.frequency);
    }

    const nextDateStr = formatDateYMD(runDate);
    await query(`UPDATE recurring_rules SET next_run_date = $1 WHERE id = $2`, [
      nextDateStr,
      rule.id,
    ]);
  }

  return createdCount;
}
