import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { MAX_NOTE_LENGTH, isNoteTab } from "@/lib/notes";

/** Saves the note of one tab. An empty note is removed. */
export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const tab = body?.tab;
    const content = body?.content;
    if (!isNoteTab(tab) || typeof content !== "string") {
      return NextResponse.json({ error: "A valid tab and note text are required." }, { status: 400 });
    }
    if (content.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `The note is too long (max ${MAX_NOTE_LENGTH} characters).` },
        { status: 400 }
      );
    }

    if (content.trim() === "") {
      await query(`DELETE FROM notes WHERE user_id = $1 AND tab = $2`, [user.id, tab]);
    } else {
      await query(
        `INSERT INTO notes (user_id, tab, content, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, tab) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
        [user.id, tab, content]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error saving note:", err);
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }
}
