import { NextResponse } from "next/server";
import { getSessionUser, getSystemConfig } from "@/lib/auth";

export async function GET() {
  try {
    const [user, config] = await Promise.all([getSessionUser(), getSystemConfig()]);
    return NextResponse.json({
      user,
      system: {
        needsSetup: config.needsSetup,
        allowRegistration: config.allowRegistration,
        authMode: config.authMode,
        oidcConfigured: config.oidcConfigured,
        oidcProviderName: config.oidcProviderName,
      },
    });
  } catch (err) {
    console.error("Error in /api/auth/status:", err);
    return NextResponse.json({ error: "Failed to load auth status" }, { status: 500 });
  }
}
