import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { processDueRecurringRules } from "@/lib/recurring";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const accountId = String(body.accountId || "");
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const type = body.type === "INCOME" ? "INCOME" : "EXPENSE";
    const amount = Math.round(Math.abs(Number(body.amount || 0)) * 100) / 100;
    const description = String(body.description || "").trim();
    const frequency = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(body.frequency)
      ? body.frequency
      : "MONTHLY";
    const todayStr = new Date().toISOString().slice(0, 10);
    const startDate = String(body.startDate || body.nextRunDate || todayStr).slice(0, 10);
    const endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
    const nextRunDate = String(body.nextRunDate || startDate).slice(0, 10);
    const isSplit = Boolean(body.isSplit);

    if (!accountId || !description || amount <= 0) {
      return NextResponse.json(
        { error: "Account, description, and positive amount are required." },
        { status: 400 }
      );
    }

    if (endDate && endDate < startDate) {
      return NextResponse.json(
        { error: "End date cannot be earlier than start date." },
        { status: 400 }
      );
    }

    const accRes = await query<{ id: string; scope: "PRIVATE" | "BUSINESS" }>(
      `SELECT id, scope FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, user.id]
    );
    if (accRes.rows.length === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    const accountScope = accRes.rows[0].scope;

    let businessSharePct = accountScope === "BUSINESS" ? 100 : 0;
    let businessAmount = accountScope === "BUSINESS" ? amount : 0;

    if (isSplit) {
      businessSharePct = Math.min(100, Math.max(0, Number(body.businessSharePct ?? 50)));
      businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
    }

    await query(
      `INSERT INTO recurring_rules
        (user_id, account_id, category_id, type, amount, description, frequency, start_date, end_date, next_run_date, is_split, business_share_pct, business_amount, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)`,
      [
        user.id,
        accountId,
        categoryId,
        type,
        amount,
        description,
        frequency,
        startDate,
        endDate,
        nextRunDate,
        isSplit,
        businessSharePct,
        businessAmount,
      ]
    );

    const generated = await processDueRecurringRules(user.id);
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
    if (!id) {
      return NextResponse.json({ error: "Missing rule ID" }, { status: 400 });
    }

    // Quick active status toggle when full fields are not sent
    if (body.description === undefined && body.amount === undefined) {
      const active = Boolean(body.active);
      await query(`UPDATE recurring_rules SET active = $1 WHERE id = $2 AND user_id = $3`, [
        active,
        id,
        user.id,
      ]);
      if (active) {
        await processDueRecurringRules(user.id);
      }
      return NextResponse.json({ ok: true });
    }

    // Full update of recurring rule
    const accountId = String(body.accountId || "");
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const type = body.type === "INCOME" ? "INCOME" : "EXPENSE";
    const amount = Math.round(Math.abs(Number(body.amount || 0)) * 100) / 100;
    const description = String(body.description || "").trim();
    const frequency = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(body.frequency)
      ? body.frequency
      : "MONTHLY";
    const todayStr = new Date().toISOString().slice(0, 10);
    const startDate = String(body.startDate || body.nextRunDate || todayStr).slice(0, 10);
    const endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
    const nextRunDate = String(body.nextRunDate || startDate).slice(0, 10);
    const isSplit = Boolean(body.isSplit);
    const active = body.active !== undefined ? Boolean(body.active) : true;

    if (!accountId || !description || amount <= 0) {
      return NextResponse.json(
        { error: "Account, description, and positive amount are required." },
        { status: 400 }
      );
    }

    if (endDate && endDate < startDate) {
      return NextResponse.json(
        { error: "End date cannot be earlier than start date." },
        { status: 400 }
      );
    }

    const accRes = await query<{ id: string; scope: "PRIVATE" | "BUSINESS" }>(
      `SELECT id, scope FROM accounts WHERE id = $1 AND user_id = $2`,
      [accountId, user.id]
    );
    if (accRes.rows.length === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    const accountScope = accRes.rows[0].scope;

    let businessSharePct = accountScope === "BUSINESS" ? 100 : 0;
    let businessAmount = accountScope === "BUSINESS" ? amount : 0;

    if (isSplit) {
      businessSharePct = Math.min(100, Math.max(0, Number(body.businessSharePct ?? 50)));
      businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
    }

    await query(
      `UPDATE recurring_rules
       SET account_id = $1,
           category_id = $2,
           type = $3,
           amount = $4,
           description = $5,
           frequency = $6,
           start_date = $7,
           end_date = $8,
           next_run_date = $9,
           is_split = $10,
           business_share_pct = $11,
           business_amount = $12,
           active = $13
       WHERE id = $14 AND user_id = $15`,
      [
        accountId,
        categoryId,
        type,
        amount,
        description,
        frequency,
        startDate,
        endDate,
        nextRunDate,
        isSplit,
        businessSharePct,
        businessAmount,
        active,
        id,
        user.id,
      ]
    );

    const generated = await processDueRecurringRules(user.id);
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
    if (!id) return NextResponse.json({ error: "Missing rule ID" }, { status: 400 });

    await query(`DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2`, [id, user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting recurring rule:", err);
    return NextResponse.json({ error: "Failed to delete recurring rule" }, { status: 500 });
  }
}
