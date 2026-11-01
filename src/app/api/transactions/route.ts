import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

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
    const notes = String(body.notes || "").trim();
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const isSplit = Boolean(body.isSplit);

    if (!accountId || !description || amount <= 0) {
      return NextResponse.json(
        { error: "Account, description, and a positive amount are required." },
        { status: 400 }
      );
    }

    // Verify account belongs to user and check its scope
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
      if (body.businessAmount !== undefined && body.businessAmount !== null) {
        businessAmount = Math.min(
          amount,
          Math.max(0, Math.round(Number(body.businessAmount) * 100) / 100)
        );
        businessSharePct = Math.round((businessAmount / amount) * 10000) / 100;
      } else {
        businessSharePct = Math.min(100, Math.max(0, Number(body.businessSharePct ?? 50)));
        businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
      }
    }

    const res = await query(
      `INSERT INTO transactions
        (user_id, account_id, category_id, type, amount, description, notes, date, is_split, business_share_pct, business_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING
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
         business_amount::float8 AS "businessAmount"`,
      [
        user.id,
        accountId,
        categoryId,
        type,
        amount,
        description,
        notes,
        date,
        isSplit,
        businessSharePct,
        businessAmount,
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
    const accountId = String(body.accountId || "");
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const type = body.type === "INCOME" ? "INCOME" : "EXPENSE";
    const amount = Math.round(Math.abs(Number(body.amount || 0)) * 100) / 100;
    const description = String(body.description || "").trim();
    const notes = String(body.notes || "").trim();
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const isSplit = Boolean(body.isSplit);

    if (!id || !accountId || !description || amount <= 0) {
      return NextResponse.json({ error: "Invalid transaction fields." }, { status: 400 });
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
      if (body.businessAmount !== undefined && body.businessAmount !== null) {
        businessAmount = Math.min(
          amount,
          Math.max(0, Math.round(Number(body.businessAmount) * 100) / 100)
        );
        businessSharePct = Math.round((businessAmount / amount) * 10000) / 100;
      } else {
        businessSharePct = Math.min(100, Math.max(0, Number(body.businessSharePct ?? 50)));
        businessAmount = Math.round(((amount * businessSharePct) / 100) * 100) / 100;
      }
    }

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
           business_amount = $10
       WHERE id = $11 AND user_id = $12
       RETURNING
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
         business_amount::float8 AS "businessAmount"`,
      [
        accountId,
        categoryId,
        type,
        amount,
        description,
        notes,
        date,
        isSplit,
        businessSharePct,
        businessAmount,
        id,
        user.id,
      ]
    );

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
    if (!id) return NextResponse.json({ error: "Missing transaction ID" }, { status: 400 });

    await query(`DELETE FROM transactions WHERE id = $1 AND user_id = $2`, [id, user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting transaction:", err);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
