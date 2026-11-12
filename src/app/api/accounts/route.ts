import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { isUuid, parseAmount } from "@/lib/validate";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const name = String(body.name || "").trim();
    const type = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "INVESTMENT"].includes(body.type)
      ? body.type
      : "CHECKING";
    const scope = body.scope === "BUSINESS" ? "BUSINESS" : "PRIVATE";
    const initialBalance = parseAmount(body.initialBalance ?? 0);
    const color = String(body.color || "#4f46e5");
    const icon = String(body.icon || "wallet");

    if (!name) {
      return NextResponse.json({ error: "Account name is required." }, { status: 400 });
    }
    if (!Number.isFinite(initialBalance)) {
      return NextResponse.json({ error: "Starting balance must be a number." }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO accounts (user_id, name, type, scope, initial_balance, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, type, scope, initial_balance::float8 AS "initialBalance", color, icon`,
      [user.id, name, type, scope, initialBalance, color, icon]
    );

    return NextResponse.json({ account: res.rows[0] });
  } catch (err) {
    console.error("Error creating account:", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const id = String(body.id || "");
    const name = String(body.name || "").trim();
    const type = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "INVESTMENT"].includes(body.type)
      ? body.type
      : "CHECKING";
    const scope = body.scope === "BUSINESS" ? "BUSINESS" : "PRIVATE";
    const initialBalance = parseAmount(body.initialBalance ?? 0);
    const color = String(body.color || "#4f46e5");
    const icon = String(body.icon || "wallet");

    if (!isUuid(id) || !name) {
      return NextResponse.json({ error: "Account ID and name are required." }, { status: 400 });
    }
    if (!Number.isFinite(initialBalance)) {
      return NextResponse.json({ error: "Starting balance must be a number." }, { status: 400 });
    }

    const res = await withTransaction(async (q) => {
      const updated = await q(
        `UPDATE accounts
         SET name = $1, type = $2, scope = $3, initial_balance = $4, color = $5, icon = $6
         WHERE id = $7 AND user_id = $8
         RETURNING id, name, type, scope, initial_balance::float8 AS "initialBalance", color, icon`,
        [name, type, scope, initialBalance, color, icon, id, user.id]
      );
      if (updated.rows.length === 0) return updated;

      // Keep the default Private/Business share of non-split transactions and rules in sync
      const defaultBizPct = scope === "BUSINESS" ? 100 : 0;
      await q(
        `UPDATE transactions
         SET business_share_pct = $1::numeric,
             business_amount = CASE WHEN $1::numeric = 100 THEN amount ELSE 0 END
         WHERE account_id = $2 AND user_id = $3 AND is_split = FALSE`,
        [defaultBizPct, id, user.id]
      );
      await q(
        `UPDATE recurring_rules
         SET business_share_pct = $1::numeric,
             business_amount = CASE WHEN $1::numeric = 100 THEN amount ELSE 0 END
         WHERE account_id = $2 AND user_id = $3 AND is_split = FALSE`,
        [defaultBizPct, id, user.id]
      );
      return updated;
    });

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account: res.rows[0] });
  } catch (err) {
    console.error("Error updating account:", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "Missing or invalid account ID" }, { status: 400 });

    await query(`DELETE FROM accounts WHERE id = $1 AND user_id = $2`, [id, user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting account:", err);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
