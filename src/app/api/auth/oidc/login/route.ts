import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getSystemConfig } from "@/lib/auth";

export async function GET() {
  try {
    const config = await getSystemConfig();
    if (config.authMode === "builtin") {
      return NextResponse.json({ error: "OIDC authentication is disabled." }, { status: 403 });
    }
    if (!config.oidcConfigured) {
      return NextResponse.json(
        { error: "OIDC is not configured yet. Please set OIDC_ISSUER and OIDC_CLIENT_ID." },
        { status: 400 }
      );
    }

    const issuer = config.oidcIssuer.replace(/\/$/, "");
    const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!discoveryRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch OIDC discovery from ${issuer}` },
        { status: 502 }
      );
    }

    const discovery = await discoveryRes.json();
    const authEndpoint = discovery.authorization_endpoint;
    if (!authEndpoint) {
      return NextResponse.json(
        { error: "OIDC provider did not return an authorization_endpoint" },
        { status: 502 }
      );
    }

    const state = randomBytes(16).toString("hex");
    const cookieStore = await cookies();
    cookieStore.set("finflow_oidc_state", state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const authUrl = new URL(authEndpoint);
    authUrl.searchParams.set("client_id", config.oidcClientId);
    authUrl.searchParams.set("redirect_uri", config.oidcRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl.toString());
  } catch (err) {
    console.error("OIDC login redirect error:", err);
    return NextResponse.json({ error: "Failed to initiate OIDC login" }, { status: 500 });
  }
}
