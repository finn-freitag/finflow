import { NextRequest, NextResponse } from "next/server";
import { getSystemConfig, setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { query, seedDefaultUserWorkspace } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const config = await getSystemConfig();
    if (!config.allowRegistration && !config.needsSetup) {
      return NextResponse.json(
        { error: "Self-registration is currently disabled by the administrator." },
        { status: 403 }
      );
    }
    if (config.authMode === "oidc") {
      return NextResponse.json(
        { error: "Built-in registration is disabled. Please sign in with OIDC." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    const currency = String(body.currency || "EUR").trim().toUpperCase();

    if (!email || !email.includes("@") || !name) {
      return NextResponse.json({ error: "Name and valid email are required." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const role = config.needsSetup ? "ADMIN" : "USER";
    const passwordHash = hashPassword(password);

    const userRes = await query<{
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "USER";
      currency: string;
    }>(
      `INSERT INTO users (email, name, password_hash, role, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, currency`,
      [email, name, passwordHash, role, currency]
    );

    const newUser = userRes.rows[0];
    await seedDefaultUserWorkspace(newUser.id, false);
    await setSessionCookie(newUser);

    return NextResponse.json({ user: newUser });
  } catch (err) {
    console.error("Error in /api/auth/register:", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
