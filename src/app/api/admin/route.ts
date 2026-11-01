import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getSystemConfig } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { query, seedDefaultUserWorkspace } from "@/lib/db";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [usersRes, systemConfig] = await Promise.all([
      query(
        `SELECT
           u.id,
           u.email,
           u.name,
           u.role,
           u.currency,
           u.oidc_sub AS "oidcSub",
           u.created_at AS "createdAt",
           (SELECT COUNT(*)::int FROM accounts a WHERE a.user_id = u.id) AS "accountCount",
           (SELECT COUNT(*)::int FROM transactions t WHERE t.user_id = u.id) AS "transactionCount"
         FROM users u
         ORDER BY u.created_at ASC`
      ),
      getSystemConfig(),
    ]);

    return NextResponse.json({
      users: usersRes.rows,
      settings: systemConfig,
    });
  } catch (err) {
    console.error("Error in GET /api/admin:", err);
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();

    // Action 1: Update system settings (self-registration, authMode, OIDC)
    if (body.action === "update_settings") {
      const updates: Record<string, string> = {
        allow_registration: body.allowRegistration ? "true" : "false",
        auth_mode: ["both", "builtin", "oidc"].includes(body.authMode) ? body.authMode : "both",
        oidc_issuer: String(body.oidcIssuer || "").trim(),
        oidc_client_id: String(body.oidcClientId || "").trim(),
        oidc_client_secret: String(body.oidcClientSecret || "").trim(),
        oidc_redirect_uri: String(body.oidcRedirectUri || "").trim(),
        oidc_provider_name: String(body.oidcProviderName || "Single Sign-On (OIDC)").trim(),
      };

      for (const [k, v] of Object.entries(updates)) {
        await query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, v]
        );
      }
      const settings = await getSystemConfig();
      return NextResponse.json({ settings });
    }

    // Action 2: Create a new user as Admin
    if (body.action === "create_user") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      const role = body.role === "ADMIN" ? "ADMIN" : "USER";
      const currency = String(body.currency || "EUR").trim().toUpperCase();

      if (!email || !email.includes("@") || !name || password.length < 6) {
        return NextResponse.json(
          { error: "Name, valid email, and password (min 6 chars) are required." },
          { status: 400 }
        );
      }

      const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
      if (existing.rows.length > 0) {
        return NextResponse.json({ error: "Email already in use." }, { status: 409 });
      }

      const passwordHash = hashPassword(password);
      const created = await query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, role, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [email, name, passwordHash, role, currency]
      );

      await seedDefaultUserWorkspace(created.rows[0].id, Boolean(body.seedDemoData));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Error in POST /api/admin:", err);
    return NextResponse.json({ error: "Admin action failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
    if (id === user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own active admin account." },
        { status: 400 }
      );
    }

    await query(`DELETE FROM users WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting user:", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
