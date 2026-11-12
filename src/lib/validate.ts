import { query, QueryFn } from "./db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parses a money amount; returns NaN for anything that is not a finite number. */
export function parseAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export async function accountScopeForUser(
  accountId: unknown,
  userId: string,
  q: QueryFn = query
): Promise<"PRIVATE" | "BUSINESS" | null> {
  if (!isUuid(accountId)) return null;
  const res = await q<{ scope: "PRIVATE" | "BUSINESS" }>(
    `SELECT scope FROM accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );
  return res.rows[0]?.scope ?? null;
}

/** True when `categoryId` is null (Root) or a folder owned by the user. */
export async function isOwnCategoryOrRoot(
  categoryId: string | null,
  userId: string,
  q: QueryFn = query
): Promise<boolean> {
  if (categoryId === null) return true;
  if (!isUuid(categoryId)) return false;
  const res = await q(`SELECT 1 FROM categories WHERE id = $1 AND user_id = $2`, [categoryId, userId]);
  return res.rows.length > 0;
}
