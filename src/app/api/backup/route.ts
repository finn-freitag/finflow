import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { BackupValidationError, exportUserData, importUserData, validateBackup } from "@/lib/backup";
import { localTodayYMD } from "@/lib/recurring-schedule";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** Downloads the signed-in user's workspace as a JSON backup file. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const backup = await exportUserData(user.id);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="finflow-backup-${localTodayYMD()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting backup:", err);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}

/** Replaces the signed-in user's workspace with the uploaded JSON backup. */
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const length = Number(req.headers.get("content-length") || 0);
    if (length > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "Backup file is too large (max 100 MB)." }, { status: 413 });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await req.text());
    } catch {
      return NextResponse.json({ error: "The file is not valid JSON." }, { status: 400 });
    }

    const data = validateBackup(raw);
    const imported = await importUserData(user.id, data);
    return NextResponse.json({ ok: true, imported });
  } catch (err) {
    if (err instanceof BackupValidationError) {
      return NextResponse.json({ error: `Invalid backup file — ${err.message}` }, { status: 400 });
    }
    console.error("Error importing backup:", err);
    return NextResponse.json(
      { error: "Import failed. Your existing data was not changed." },
      { status: 500 }
    );
  }
}
