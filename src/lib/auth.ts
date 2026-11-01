import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { query } from "./db";

const SESSION_COOKIE_NAME = "finflow_session";

function getSecretKey(): Uint8Array {
  const secret =
    process.env.JWT_SECRET || "change-this-super-secret-jwt-key-in-production-min-32-chars";
  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  currency: string;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    currency: user.currency,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecretKey());
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub) return null;

    const res = await query<{
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "USER";
      currency: string;
    }>(`SELECT id, email, name, role, currency FROM users WHERE id = $1`, [payload.sub]);

    if (!res.rows[0]) return null;
    return res.rows[0];
  } catch {
    return null;
  }
}

export interface SystemConfig {
  needsSetup: boolean;
  allowRegistration: boolean;
  authMode: "both" | "builtin" | "oidc";
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcRedirectUri: string;
  oidcProviderName: string;
  oidcConfigured: boolean;
}

export async function getSystemConfig(): Promise<SystemConfig> {
  const countRes = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM users`);
  const userCount = parseInt(countRes.rows[0]?.count || "0", 10);

  const settingsRes = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings`
  );
  const map: Record<string, string> = {};
  for (const row of settingsRes.rows) {
    map[row.key] = row.value;
  }

  const oidcIssuer = (map.oidc_issuer || process.env.OIDC_ISSUER || "").trim();
  const oidcClientId = (map.oidc_client_id || process.env.OIDC_CLIENT_ID || "").trim();
  const oidcClientSecret = (map.oidc_client_secret || process.env.OIDC_CLIENT_SECRET || "").trim();
  const oidcRedirectUri = (
    map.oidc_redirect_uri ||
    process.env.OIDC_REDIRECT_URI ||
    `${process.env.APP_URL || "http://localhost:3000"}/api/auth/oidc/callback`
  ).trim();
  const oidcProviderName = (
    map.oidc_provider_name ||
    process.env.OIDC_PROVIDER_NAME ||
    "Single Sign-On (OIDC)"
  ).trim();

  const rawAuthMode = (map.auth_mode || process.env.AUTH_MODE || "both").toLowerCase();
  const authMode: "both" | "builtin" | "oidc" =
    rawAuthMode === "builtin" || rawAuthMode === "oidc" ? rawAuthMode : "both";

  return {
    needsSetup: userCount === 0,
    allowRegistration: map.allow_registration === "true",
    authMode,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcRedirectUri,
    oidcProviderName,
    oidcConfigured: Boolean(oidcIssuer && oidcClientId),
  };
}
