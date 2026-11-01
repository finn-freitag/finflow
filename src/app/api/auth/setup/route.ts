import { NextRequest, NextResponse } from "next/server";
import { getSystemConfig, setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { query, seedDefaultUserWorkspace } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const config = await getSystemConfig();
    if (!config.needsSetup) {
      return NextResponse.json(
        { error: "Initial setup has already been completed." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "Administrator").trim();
    const password = String(body.password || "");
    const currency = String(body.currency || "EUR").trim().toUpperCase();
    const allowRegistration = Boolean(body.allowRegistration);
    const authMode = ["both", "builtin", "oidc"].includes(body.authMode) ? body.authMode : "both";
    const seedDemoData = body.seedDemoData !== false;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    const passwordHash = hashPassword(password);
    const userRes = await query<{
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "USER";
      currency: string;
    }>(
      `INSERT INTO users (email, name, password_hash, role, currency)
       VALUES ($1, $2, $3, 'ADMIN', $4)
       RETURNING id, email, name, role, currency`,
      [email, name, passwordHash, currency]
    );

    const adminUser = userRes.rows[0];

    // Save initial system settings
    const settingsToUpdate: Record<string, string> = {
      allow_registration: allowRegistration ? "true" : "false",
      auth_mode: authMode,
    };
    if (body.oidcIssuer !== undefined) settingsToUpdate.oidc_issuer = String(body.oidcIssuer).trim();
    if (body.oidcClientId !== undefined)
      settingsToUpdate.oidc_client_id = String(body.oidcClientId).trim();
    if (body.oidcClientSecret !== undefined)
      settingsToUpdate.oidc_client_secret = String(body.oidcClientSecret).trim();
    if (body.oidcProviderName !== undefined)
      settingsToUpdate.oidc_provider_name = String(body.oidcProviderName).trim();

    for (const [k, v] of Object.entries(settingsToUpdate)) {
      await query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [k, v]
      );
    }

    await seedDefaultUserWorkspace(adminUser.id, seedDemoData);
    await setSessionCookie(adminUser);

    return NextResponse.json({ user: adminUser });
  } catch (err) {
    console.error("Error in /api/auth/setup:", err);
    return NextResponse.json({ error: "Failed to complete setup" }, { status: 500 });
  }
}
