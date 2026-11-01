import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { processDueRecurringRules } from "@/lib/recurring";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const generatedRecurringCount = await processDueRecurringRules(user.id);

    const [accountsRes, categoriesRes, transactionsRes, recurringRes] = await Promise.all([
      query(
        `SELECT id, name, type, scope, initial_balance::float8 AS "initialBalance", color, icon, created_at AS "createdAt"
         FROM accounts
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [user.id]
      ),
      query(
        `SELECT id, parent_id AS "parentId", name, color, icon, sort_order AS "sortOrder", created_at AS "createdAt"
         FROM categories
         WHERE user_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [user.id]
      ),
      query(
        `SELECT
           id,
           account_id AS "accountId",
           category_id AS "categoryId",
           type,
           amount::float8 AS amount,
           description,
           notes,
           to_char(date, 'YYYY-MM-DD') AS date,
           is_split AS "isSplit",
           business_share_pct::float8 AS "businessSharePct",
           business_amount::float8 AS "businessAmount",
           recurring_rule_id AS "recurringRuleId",
           created_at AS "createdAt"
         FROM transactions
         WHERE user_id = $1
         ORDER BY date DESC, created_at DESC`,
        [user.id]
      ),
      query(
        `SELECT
           id,
           account_id AS "accountId",
           category_id AS "categoryId",
           type,
           amount::float8 AS amount,
           description,
           frequency,
           to_char(next_run_date, 'YYYY-MM-DD') AS "nextRunDate",
           is_split AS "isSplit",
           business_share_pct::float8 AS "businessSharePct",
           business_amount::float8 AS "businessAmount",
           active
         FROM recurring_rules
         WHERE user_id = $1
         ORDER BY next_run_date ASC`,
        [user.id]
      ),
    ]);

    return NextResponse.json({
      user,
      generatedRecurringCount,
      accounts: accountsRes.rows,
      categories: categoriesRes.rows,
      transactions: transactionsRes.rows,
      recurringRules: recurringRes.rows,
    });
  } catch (err) {
    console.error("Error in /api/finance:", err);
    return NextResponse.json({ error: "Failed to load finance data" }, { status: 500 });
  }
}
