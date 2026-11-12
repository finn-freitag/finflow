import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import {
  loadRule,
  pauseRule,
  resumeRule,
  rewriteRule,
  setRuleActive,
  syncRule,
} from "@/lib/recurring";
import { FREQUENCIES, Frequency, isValidYMD, localTodayYMD } from "@/lib/recurring-schedule";
import { accountScopeForUser, isOwnCategoryOrRoot, isUuid, parseAmount } from "@/lib/validate";

interface RuleInput {
  accountId: string;
  categoryId: string | null;
  type: "EXPENSE" | "INCOME";
  amount: number;
  description: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
}

type ParseResult = { ok: true; input: RuleInput } | { ok: false; status: number; error: string };

async function parseRuleInput(body: Record<string, unknown>, userId: string): Promise<ParseResult> {
  const accountId = String(body.accountId || "");
  const categoryId = body.categoryId ? String(body.categoryId) : null;
  const type = body.type === "INCOME" ? "INCOME" : "EXPENSE";
  const amount = Math.abs(parseAmount(body.amount));
  const description = String(body.description || "").trim();
  const frequency = FREQUENCIES.includes(body.frequency as Frequency)
    ? (body.frequency as Frequency)
    : "MONTHLY";
  const startDate = body.startDate ? String(body.startDate).slice(0, 10) : localTodayYMD();
  const endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
  const isSplit = Boolean(body.isSplit);

  if (!accountId || !description || !(amount > 0)) {
    return { ok: false, status: 400, error: "Account, description, and positive amount are required." };
  }
  if (!isValidYMD(startDate) || (endDate !== null && !isValidYMD(endDate))) {
    return { ok: false, status: 400, error: "Invalid start or end date." };
  }
  if (endDate && endDate < startDate) {
    return { ok: false, status: 400, error: "End date cannot be earlier than start date." };
  }

  const accountScope = await accountScopeForUser(accountId, userId);
  if (!accountScope) return { ok: false, status: 404, error: "Account not found." };
  if (!(await isOwnCategoryOrRoot(categoryId, userId))) {
    return { ok: false, status: 404, error: "Category folder not found." };
  }

  let businessSharePct = accountScope === "BUSINESS" ? 100 : 0;
  let businessAmount = accountScope === "BUSINESS" ? amount : 0;
  if (isSplit) {
    const pct = Number(body.businessSharePct ?? 50);
    businessSharePct = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 50));
    businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
  }

  return {
    ok: true,
    input: {
      accountId,
      categoryId,
      type,
      amount,
      description,
      frequency,
      startDate,
      endDate,
      isSplit,
      businessSharePct,
      businessAmount,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseRuleInput(await req.json(), user.id);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const r = parsed.input;

    const generated = await withTransaction(async (q) => {
      const ins = await q<{ id: string }>(
        `INSERT INTO recurring_rules
          (user_id, account_id, category_id, type, amount, description, frequency, start_date, end_date,
           next_run_date, is_split, business_share_pct, business_amount, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $11, $12, TRUE)
         RETURNING id`,
        [
          user.id,
          r.accountId,
          r.categoryId,
          r.type,
          r.amount,
          r.description,
          r.frequency,
          r.startDate,
          r.endDate,
          r.isSplit,
          r.businessSharePct,
          r.businessAmount,
        ]
      );
      const rule = await loadRule(q, ins.rows[0].id, user.id);
      return rule ? syncRule(q, rule) : 0;
    });

    return NextResponse.json({ ok: true, generated });
  } catch (err) {
    console.error("Error creating recurring rule:", err);
    return NextResponse.json({ error: "Failed to create recurring rule" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const id = String(body.id || "");
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Missing or invalid rule ID" }, { status: 400 });
    }

    // Quick pause / resume toggle when full fields are not sent
    if (body.description === undefined && body.amount === undefined) {
      const found = await setRuleActive(id, user.id, Boolean(body.active));
      if (!found) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const parsed = await parseRuleInput(body, user.id);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const r = parsed.input;
    const wantActive = body.active !== undefined ? Boolean(body.active) : true;

    const generated = await withTransaction(async (q) => {
      const prev = await loadRule(q, id, user.id);
      if (!prev) return null;

      await q(
        `UPDATE recurring_rules
         SET account_id = $1,
             category_id = $2,
             type = $3,
             amount = $4,
             description = $5,
             frequency = $6,
             start_date = $7,
             end_date = $8,
             is_split = $9,
             business_share_pct = $10,
             business_amount = $11
         WHERE id = $12 AND user_id = $13`,
        [
          r.accountId,
          r.categoryId,
          r.type,
          r.amount,
          r.description,
          r.frequency,
          r.startDate,
          r.endDate,
          r.isSplit,
          r.businessSharePct,
          r.businessAmount,
          id,
          user.id,
        ]
      );

      const rule = (await loadRule(q, id, user.id))!;
      if (wantActive && !rule.active) await resumeRule(q, rule);
      if (!wantActive && rule.active) await pauseRule(q, rule);
      return rewriteRule(q, rule, prev.frequency);
    });

    if (generated === null) {
      return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, generated });
  } catch (err) {
    console.error("Error updating recurring rule:", err);
    return NextResponse.json({ error: "Failed to update recurring rule" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "Missing or invalid rule ID" }, { status: 400 });

    await withTransaction(async (q) => {
      // Entries that were already booked stay as normal transactions.
      await q(
        `UPDATE transactions
         SET recurring_rule_id = NULL, recurring_period = NULL, recurring_modified = FALSE
         WHERE recurring_rule_id = $1 AND user_id = $2`,
        [id, user.id]
      );
      await q(`DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2`, [id, user.id]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting recurring rule:", err);
    return NextResponse.json({ error: "Failed to delete recurring rule" }, { status: 500 });
  }
}
