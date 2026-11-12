import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSystemConfig, setSessionCookie } from "@/lib/auth";
import { query, seedDefaultUserWorkspace } from "@/lib/db";

export async function GET(req: NextRequest) {
  const appBase = process.env.APP_URL || req.nextUrl.origin;

  try {
    const config = await getSystemConfig();
    if (!config.oidcConfigured) {
      return NextResponse.redirect(`${appBase}/?error=oidc_not_configured`);
    }

    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const cookieStore = await cookies();
    const savedState = cookieStore.get("finflow_oidc_state")?.value;
    cookieStore.delete("finflow_oidc_state");

    if (!code || !state || !savedState || state !== savedState) {
      return NextResponse.redirect(`${appBase}/?error=invalid_oidc_state`);
    }

    const issuer = config.oidcIssuer.replace(/\/$/, "");
    const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!discoveryRes.ok) {
      return NextResponse.redirect(`${appBase}/?error=oidc_discovery_failed`);
    }
    const discovery = await discoveryRes.json();

    // Exchange code for token
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.oidcRedirectUri,
      client_id: config.oidcClientId,
    });
    if (config.oidcClientSecret) {
      tokenParams.set("client_secret", config.oidcClientSecret);
    }

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${appBase}/?error=oidc_token_exchange_failed`);
    }
    const tokens = await tokenRes.json();

    // Decode ID token payload or call userinfo_endpoint
    let claims: Record<string, unknown> = {};
    if (tokens.id_token) {
      const parts = String(tokens.id_token).split(".");
      if (parts.length === 3) {
        claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      }
    }

    if ((!claims.email || !claims.sub) && discovery.userinfo_endpoint && tokens.access_token) {
      const userInfoRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoRes.ok) {
        const info = await userInfoRes.json();
        claims = { ...claims, ...info };
      }
    }

    const sub = String(claims.sub || "");
    const email = String(claims.email || `${sub}@oidc.local`).toLowerCase();
    const name = String(claims.name || claims.preferred_username || email.split("@")[0]);

    if (!sub) {
      return NextResponse.redirect(`${appBase}/?error=oidc_missing_sub`);
    }

    // Find user by oidc_sub; link an existing account by email only if the provider verified
    // that email (otherwise anyone could claim someone else's address at the provider).
    const emailVerified = claims.email_verified === true || claims.email_verified === "true";
    const existingRes = await query<{
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "USER";
      currency: string;
      oidc_sub: string | null;
    }>(
      `SELECT id, email, name, role, currency, oidc_sub FROM users
       WHERE oidc_sub = $1 OR ($3::boolean AND email = $2)
       ORDER BY (oidc_sub = $1) DESC NULLS LAST
       LIMIT 1`,
      [sub, email, emailVerified]
    );

    if (!existingRes.rows[0] && !emailVerified) {
      const emailTaken = await query(`SELECT 1 FROM users WHERE email = $1`, [email]);
      if (emailTaken.rows.length > 0) {
        return NextResponse.redirect(`${appBase}/?error=oidc_email_not_verified`);
      }
    }

    let user = existingRes.rows[0];

    if (user) {
      if (!user.oidc_sub) {
        await query(`UPDATE users SET oidc_sub = $1 WHERE id = $2`, [sub, user.id]);
      } else if (user.oidc_sub !== sub) {
        return NextResponse.redirect(`${appBase}/?error=oidc_account_conflict`);
      }
    } else {
      if (!config.allowRegistration && !config.needsSetup) {
        return NextResponse.redirect(`${appBase}/?error=registration_disabled`);
      }
      const role = config.needsSetup ? "ADMIN" : "USER";
      const createdRes = await query<{
        id: string;
        email: string;
        name: string;
        role: "ADMIN" | "USER";
        currency: string;
        oidc_sub: string | null;
      }>(
        `INSERT INTO users (email, name, oidc_sub, role, currency)
         VALUES ($1, $2, $3, $4, 'EUR')
         RETURNING id, email, name, role, currency, oidc_sub`,
        [email, name, sub, role]
      );
      user = createdRes.rows[0];
      await seedDefaultUserWorkspace(user.id, config.needsSetup);
    }

    await setSessionCookie({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      currency: user.currency,
    });

    return NextResponse.redirect(`${appBase}/`);
  } catch (err) {
    console.error("OIDC callback error:", err);
    return NextResponse.redirect(`${appBase}/?error=oidc_callback_error`);
  }
}
