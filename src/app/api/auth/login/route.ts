import { NextRequest, NextResponse } from "next/server";
import { getSystemConfig, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { query } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const config = await getSystemConfig();
    if (config.authMode === "oidc") {
      return NextResponse.json(
        { error: "Built-in password login is disabled by the administrator. Please use OIDC." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const userRes = await query<{
      id: string;
      email: string;
      name: string;
      password_hash: string | null;
      role: "ADMIN" | "USER";
      currency: string;
    }>(`SELECT id, email, name, password_hash, role, currency FROM users WHERE email = $1`, [
      email,
    ]);

    const user = userRes.rows[0];
    if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      currency: user.currency,
    };

    await setSessionCookie(sessionUser);
    return NextResponse.json({ user: sessionUser });
  } catch (err) {
    console.error("Error in /api/auth/login:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
