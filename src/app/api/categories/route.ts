import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { isOwnCategoryOrRoot, isUuid } from "@/lib/validate";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const name = String(body.name || "").trim();
    const parentId = body.parentId ? String(body.parentId) : null;
    const color = String(body.color || "#6366f1");
    const icon = String(body.icon || "folder");

    if (!name) {
      return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
    }

    if (!(await isOwnCategoryOrRoot(parentId, user.id))) {
      return NextResponse.json({ error: "Parent folder not found." }, { status: 404 });
    }

    const res = await query(
      `INSERT INTO categories (user_id, parent_id, name, color, icon)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, parent_id AS "parentId", name, color, icon, sort_order AS "sortOrder"`,
      [user.id, parentId, name, color, icon]
    );

    return NextResponse.json({ category: res.rows[0] });
  } catch (err) {
    console.error("Error creating category folder:", err);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const id = String(body.id || "");
    const name = String(body.name || "").trim();
    const parentId = body.parentId ? String(body.parentId) : null;
    const color = String(body.color || "#6366f1");
    const icon = String(body.icon || "folder");

    if (!isUuid(id) || !name) {
      return NextResponse.json({ error: "Folder ID and name are required." }, { status: 400 });
    }
    if (!(await isOwnCategoryOrRoot(parentId, user.id))) {
      return NextResponse.json({ error: "Parent folder not found." }, { status: 404 });
    }
    if (parentId === id) {
      return NextResponse.json({ error: "A folder cannot be its own parent." }, { status: 400 });
    }

    // Prevent circular hierarchy
    if (parentId) {
      const allCats = await query<{ id: string; parent_id: string | null }>(
        `SELECT id, parent_id FROM categories WHERE user_id = $1`,
        [user.id]
      );
      const parentMap = new Map<string, string | null>();
      for (const c of allCats.rows) parentMap.set(c.id, c.parent_id);

      let curr: string | null = parentId;
      while (curr) {
        if (curr === id) {
          return NextResponse.json(
            { error: "Cannot move a folder inside one of its own subfolders." },
            { status: 400 }
          );
        }
        curr = parentMap.get(curr) || null;
      }
    }

    const res = await query(
      `UPDATE categories
       SET name = $1, parent_id = $2, color = $3, icon = $4
       WHERE id = $5 AND user_id = $6
       RETURNING id, parent_id AS "parentId", name, color, icon, sort_order AS "sortOrder"`,
      [name, parentId, color, icon, id, user.id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }
    return NextResponse.json({ category: res.rows[0] });
  } catch (err) {
    console.error("Error updating category folder:", err);
    return NextResponse.json({ error: "Failed to update folder" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "Missing or invalid folder ID" }, { status: 400 });

    // Subfolders, transactions and recurring rules of the deleted folder move up to its parent
    // (or Root), so nothing is lost or silently uncategorized.
    await withTransaction(async (q) => {
      const folderRes = await q<{ parent_id: string | null }>(
        `SELECT parent_id FROM categories WHERE id = $1 AND user_id = $2`,
        [id, user.id]
      );
      if (folderRes.rows.length === 0) return;
      const parentId = folderRes.rows[0].parent_id;

      await q(`UPDATE categories SET parent_id = $1 WHERE parent_id = $2 AND user_id = $3`, [
        parentId,
        id,
        user.id,
      ]);
      await q(`UPDATE transactions SET category_id = $1 WHERE category_id = $2 AND user_id = $3`, [
        parentId,
        id,
        user.id,
      ]);
      await q(`UPDATE recurring_rules SET category_id = $1 WHERE category_id = $2 AND user_id = $3`, [
        parentId,
        id,
        user.id,
      ]);
      await q(`DELETE FROM categories WHERE id = $1 AND user_id = $2`, [id, user.id]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error deleting category folder:", err);
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 });
  }
}
