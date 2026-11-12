import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidYMD, localTodayYMD } from "@/lib/recurring-schedule";
import { accountScopeForUser, isOwnCategoryOrRoot, isUuid, parseAmount } from "@/lib/validate";

const RETURNING = `
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
  recurring_modified AS "recurringModified"`;

interface TxInput {
  accountId: string;
  categoryId: string | null;
  type: "EXPENSE" | "INCOME";
  amount: number;
  description: string;
  notes: string;
  date: string;
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
}

type ParseResult = { ok: true; input: TxInput } | { ok: false; status: number; error: string };

async function parseTxInput(body: Record<string, unknown>, userId: string): Promise<ParseResult> {
  const accountId = String(body.accountId || "");
  const categoryId = body.categoryId ? String(body.categoryId) : null;
  const type = body.type === "INCOME" ? "INCOME" : "EXPENSE";
  const amount = Math.abs(parseAmount(body.amount));
  const description = String(body.description || "").trim();
  const notes = String(body.notes || "").trim();
  const date = body.date ? String(body.date).slice(0, 10) : localTodayYMD();
  const isSplit = Boolean(body.isSplit);

  if (!accountId || !description || !(amount > 0)) {
    return { ok: false, status: 400, error: "Account, description, and a positive amount are required." };
  }
  if (!isValidYMD(date)) return { ok: false, status: 400, error: "Invalid date." };

  const accountScope = await accountScopeForUser(accountId, userId);
  if (!accountScope) return { ok: false, status: 404, error: "Account not found." };
  if (!(await isOwnCategoryOrRoot(categoryId, userId))) {
    return { ok: false, status: 404, error: "Category folder not found." };
  }

  let businessSharePct = accountScope === "BUSINESS" ? 100 : 0;
  let businessAmount = accountScope === "BUSINESS" ? amount : 0;

  if (isSplit) {
    const bizInput = body.businessAmount;
    if (bizInput !== undefined && bizInput !== null && Number.isFinite(parseAmount(bizInput))) {
      businessAmount = Math.min(amount, Math.max(0, parseAmount(bizInput)));
      businessSharePct = Math.round((businessAmount / amount) * 10000) / 100;
    } else {
      const pct = Number(body.businessSharePct ?? 50);
      businessSharePct = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 50));
      businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
    }
  }

  return {
    ok: true,
    input: { accountId, categoryId, type, amount, description, notes, date, isSplit, businessSharePct, businessAmount },
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseTxInput(await req.json(), user.id);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const t = parsed.input;

    const res = await query(
      `INSERT INTO transactions
        (user_id, account_id, category_id, type, amount, description, notes, date, is_split, business_share_pct, business_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${RETURNING}`,
      [
        user.id,
        t.accountId,
        t.categoryId,
        t.type,
        t.amount,
        t.description,
        t.notes,
        t.date,
        t.isSplit,
        t.businessSharePct,
        t.businessAmount,
      ]
    );

    return NextResponse.json({ transaction: res.rows[0] });
  } catch (err) {
    console.error("Error creating transaction:", err);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const id = String(body.id || "");
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid transaction ID." }, { status: 400 });

    const parsed = await parseTxInput(body, user.id);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const t = parsed.input;

    // An edited recurring entry is flagged so rule changes never overwrite the user's edit.
    const res = await query(
      `UPDATE transactions
       SET account_id = $1,
           category_id = $2,
           type = $3,
           amount = $4,
           description = $5,
           notes = $6,
           date = $7,
           is_split = $8,
           business_share_pct = $9,
           business_amount = $10,
           recurring_modified = (recurring_rule_id IS NOT NULL)
       WHERE id = $11 AND user_id = $12
       RETURNING ${RETURNING}`,
      [
        t.accountId,
        t.categoryId,
        t.type,
        t.amount,
        t.description,
        t.notes,
        t.date,
        t.isSplit,
        t.businessSharePct,
        t.businessAmount,
        id,
        user.id,
      ]
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    return NextResponse.json({ transaction: res.rows[0] });
  } catch (err) {
    console.error("Error updating transaction:", err);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });

    // Deleting a recurring entry remembers its period as skipped, so it is not booked again.
    await query(
      `WITH deleted AS (
         DELETE FROM transactions WHERE id = $1 AND user_id = $2
         RETURNING recurring_rule_id, recurring_period
       )
       INSERT INTO recurring_skips (rule_id, period)
       SELECT d.recurring_rule_id, d.recurring_period
       FROM deleted d
       JOIN recurring_rules r ON r.id = d.recurring_rule_id
       WHERE d.recurring_period IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [id, user.id]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting transaction:", err);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
