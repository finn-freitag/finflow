import { randomUUID } from "crypto";
import { query, QueryFn, withTransaction } from "./db";
import { FREQUENCIES, Frequency, isValidYMD } from "./recurring-schedule";

/**
 * JSON backup of one user's workspace (accounts, folders, transactions, recurring rules).
 * Importing replaces the user's whole workspace inside a single database transaction; any
 * validation error aborts before anything is changed. All IDs are remapped on import, so a
 * backup can be restored into any account or instance.
 */

export const BACKUP_FORMAT = "finflow-backup";
// Version 2 added transfers (type "TRANSFER" with toAccountId) for transactions and recurring
// rules; version 1 files still import.
export const BACKUP_VERSION = 2;

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "INVESTMENT"] as const;
const SCOPES = ["PRIVATE", "BUSINESS"] as const;
const TX_TYPES = ["EXPENSE", "INCOME", "TRANSFER"] as const;
const MAX_RECORDS = 500_000;

export interface BackupAccount {
  id: string;
  name: string;
  type: (typeof ACCOUNT_TYPES)[number];
  scope: (typeof SCOPES)[number];
  initialBalance: number;
  color: string;
  icon: string;
  createdAt: string;
}

export interface BackupCategory {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: string;
}

export interface BackupRecurringRule {
  id: string;
  accountId: string;
  /** Destination account of a recurring transfer; null for income and expenses. */
  toAccountId: string | null;
  categoryId: string | null;
  type: (typeof TX_TYPES)[number];
  amount: number;
  description: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
  active: boolean;
  pausedSince: string | null;
  createdAt: string;
}

export interface BackupRecurringSkip {
  ruleId: string;
  period: string;
}

export interface BackupTransaction {
  id: string;
  accountId: string;
  /** Destination account of a transfer; null for income and expenses. */
  toAccountId: string | null;
  categoryId: string | null;
  type: (typeof TX_TYPES)[number];
  amount: number;
  description: string;
  notes: string;
  date: string;
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
  recurringRuleId: string | null;
  recurringPeriod: string | null;
  recurringModified: boolean;
  createdAt: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  user: { currency: string };
  accounts: BackupAccount[];
  categories: BackupCategory[];
  recurringRules: BackupRecurringRule[];
  recurringSkips: BackupRecurringSkip[];
  transactions: BackupTransaction[];
}

export interface ImportSummary {
  accounts: number;
  categories: number;
  recurringRules: number;
  transactions: number;
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

export async function exportUserData(userId: string): Promise<BackupFile> {
  const [userRes, accounts, categories, rules, skips, transactions] = await Promise.all([
    query<{ currency: string }>(`SELECT currency FROM users WHERE id = $1`, [userId]),
    query<BackupAccount>(
      `SELECT id, name, type, scope, initial_balance::float8 AS "initialBalance", color, icon,
              created_at AS "createdAt"
       FROM accounts WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    ),
    query<BackupCategory>(
      `SELECT id, parent_id AS "parentId", name, color, icon, sort_order AS "sortOrder",
              created_at AS "createdAt"
       FROM categories WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    ),
    query<BackupRecurringRule>(
      `SELECT id, account_id AS "accountId", to_account_id AS "toAccountId",
              category_id AS "categoryId", type,
              amount::float8 AS amount, description, frequency,
              to_char(start_date, 'YYYY-MM-DD') AS "startDate",
              to_char(end_date, 'YYYY-MM-DD') AS "endDate",
              is_split AS "isSplit", business_share_pct::float8 AS "businessSharePct",
              business_amount::float8 AS "businessAmount", active,
              to_char(paused_since, 'YYYY-MM-DD') AS "pausedSince", created_at AS "createdAt"
       FROM recurring_rules WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    ),
    query<BackupRecurringSkip>(
      `SELECT s.rule_id AS "ruleId", s.period
       FROM recurring_skips s JOIN recurring_rules r ON r.id = s.rule_id
       WHERE r.user_id = $1 ORDER BY s.rule_id, s.period`,
      [userId]
    ),
    query<BackupTransaction>(
      `SELECT id, account_id AS "accountId", to_account_id AS "toAccountId",
              category_id AS "categoryId", type,
              amount::float8 AS amount, description, notes,
              to_char(date, 'YYYY-MM-DD') AS date, is_split AS "isSplit",
              business_share_pct::float8 AS "businessSharePct",
              business_amount::float8 AS "businessAmount",
              recurring_rule_id AS "recurringRuleId", recurring_period AS "recurringPeriod",
              recurring_modified AS "recurringModified", created_at AS "createdAt"
       FROM transactions WHERE user_id = $1 ORDER BY date, created_at, id`,
      [userId]
    ),
  ]);

  const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user: { currency: userRes.rows[0]?.currency || "EUR" },
    accounts: accounts.rows.map((a) => ({ ...a, createdAt: toIso(a.createdAt) })),
    categories: categories.rows.map((c) => ({ ...c, createdAt: toIso(c.createdAt) })),
    recurringRules: rules.rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt) })),
    recurringSkips: skips.rows,
    transactions: transactions.rows.map((t) => ({ ...t, createdAt: toIso(t.createdAt) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export class BackupValidationError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new BackupValidationError(`${path}: ${message}`);
}

function asObject(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "must be an object");
  return v as Obj;
}

function asArray(v: unknown, path: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail(path, "must be an array");
  if (v.length > MAX_RECORDS) fail(path, `too many entries (max ${MAX_RECORDS})`);
  return v;
}

function str(o: Obj, key: string, path: string, opts: { max?: number; allowEmpty?: boolean; fallback?: string } = {}): string {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.fallback !== undefined) return opts.fallback;
    fail(`${path}.${key}`, "is required");
  }
  if (typeof v !== "string") fail(`${path}.${key}`, "must be a string");
  const s = v.trim();
  if (!opts.allowEmpty && !s) fail(`${path}.${key}`, "must not be empty");
  if (s.length > (opts.max ?? 500)) fail(`${path}.${key}`, `is too long (max ${opts.max ?? 500})`);
  return s;
}

function optRef(o: Obj, key: string, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") fail(`${path}.${key}`, "must be a string or null");
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], path: string): T {
  const v = o[key];
  if (!allowed.includes(v as T)) fail(`${path}.${key}`, `must be one of ${allowed.join(", ")}`);
  return v as T;
}

function num(o: Obj, key: string, path: string, opts: { min?: number; max?: number; fallback?: number } = {}): number {
  const v = o[key];
  if ((v === undefined || v === null) && opts.fallback !== undefined) return opts.fallback;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) fail(`${path}.${key}`, "must be a number");
  if (opts.min !== undefined && n < opts.min) fail(`${path}.${key}`, `must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) fail(`${path}.${key}`, `must be ≤ ${opts.max}`);
  if (Math.abs(n) >= 1e12) fail(`${path}.${key}`, "is too large");
  return Math.round(n * 100) / 100;
}

function bool(o: Obj, key: string, fallback: boolean): boolean {
  const v = o[key];
  return typeof v === "boolean" ? v : fallback;
}

function date(o: Obj, key: string, path: string, required: boolean): string | null {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (required) fail(`${path}.${key}`, "is required");
    return null;
  }
  if (!isValidYMD(v)) fail(`${path}.${key}`, "must be a date in YYYY-MM-DD format");
  return v;
}

function timestamp(o: Obj, key: string): string | null {
  const v = o[key];
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function color(o: Obj, key: string, fallback: string): string {
  const v = o[key];
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

function uniqueId(o: Obj, path: string, seen: Set<string>): string {
  const id = str(o, "id", path, { max: 100 });
  if (seen.has(id)) fail(`${path}.id`, `duplicate id "${id}"`);
  seen.add(id);
  return id;
}

function splitShares(o: Obj, path: string, amount: number, isSplit: boolean, scope: string) {
  if (!isSplit) {
    const biz = scope === "BUSINESS";
    return { businessSharePct: biz ? 100 : 0, businessAmount: biz ? amount : 0 };
  }
  const businessSharePct = num(o, "businessSharePct", path, { min: 0, max: 100, fallback: 0 });
  const businessAmount = num(o, "businessAmount", path, {
    min: 0,
    fallback: Math.round(((amount * businessSharePct) / 100) * 100) / 100,
  });
  if (businessAmount > amount) fail(`${path}.businessAmount`, "must not exceed amount");
  return { businessSharePct, businessAmount };
}

/** Validates a parsed backup file and returns normalized data, or throws BackupValidationError. */
export function validateBackup(raw: unknown): BackupFile {
  const root = asObject(raw, "backup");
  if (root.format !== BACKUP_FORMAT) {
    fail("backup.format", `this is not a FinFlow backup file (expected "${BACKUP_FORMAT}")`);
  }
  const version = Number(root.version);
  if (!Number.isInteger(version) || version < 1) fail("backup.version", "is missing or invalid");
  if (version > BACKUP_VERSION) {
    fail("backup.version", `was created by a newer FinFlow version (${version}); please update the app first`);
  }

  const userObj = root.user === undefined ? {} : asObject(root.user, "backup.user");
  const currencyRaw = typeof userObj.currency === "string" ? userObj.currency.trim().toUpperCase() : "EUR";
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : "EUR";

  // Accounts
  const accountIds = new Set<string>();
  const accountScope = new Map<string, string>();
  const accounts: BackupAccount[] = asArray(root.accounts, "accounts").map((v, i) => {
    const p = `accounts[${i}]`;
    const o = asObject(v, p);
    const id = uniqueId(o, p, accountIds);
    const scope = oneOf(o, "scope", SCOPES, p);
    accountScope.set(id, scope);
    return {
      id,
      name: str(o, "name", p, { max: 200 }),
      type: oneOf(o, "type", ACCOUNT_TYPES, p),
      scope,
      initialBalance: num(o, "initialBalance", p, { fallback: 0 }),
      color: color(o, "color", "#4f46e5"),
      icon: str(o, "icon", p, { max: 50, fallback: "wallet" }),
      createdAt: timestamp(o, "createdAt") ?? "",
    };
  });

  // Categories
  const categoryIds = new Set<string>();
  const categories: BackupCategory[] = asArray(root.categories, "categories").map((v, i) => {
    const p = `categories[${i}]`;
    const o = asObject(v, p);
    return {
      id: uniqueId(o, p, categoryIds),
      parentId: optRef(o, "parentId", p),
      name: str(o, "name", p, { max: 200 }),
      color: color(o, "color", "#6366f1"),
      icon: str(o, "icon", p, { max: 50, fallback: "folder" }),
      sortOrder: Math.trunc(num(o, "sortOrder", p, { fallback: 0, min: -1e6, max: 1e6 })),
      createdAt: timestamp(o, "createdAt") ?? "",
    };
  });
  const parentOf = new Map<string, string | null>();
  categories.forEach((c, i) => {
    if (c.parentId !== null && !categoryIds.has(c.parentId)) {
      fail(`categories[${i}].parentId`, `refers to unknown folder "${c.parentId}"`);
    }
    parentOf.set(c.id, c.parentId);
  });
  for (const c of categories) {
    const visited = new Set<string>();
    let cur: string | null = c.id;
    while (cur) {
      if (visited.has(cur)) fail("categories", `folder "${c.name}" is part of a parent cycle`);
      visited.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  const accountRef = (o: Obj, p: string) => {
    const id = str(o, "accountId", p, { max: 100 });
    if (!accountIds.has(id)) fail(`${p}.accountId`, `refers to unknown account "${id}"`);
    return id;
  };
  /** Destination account of a transfer (null for income/expense), checked against accountId. */
  const transferTarget = (o: Obj, p: string, type: string, accountId: string) => {
    if (type !== "TRANSFER") return null;
    const toAccountId = str(o, "toAccountId", p, { max: 100 });
    if (!accountIds.has(toAccountId)) fail(`${p}.toAccountId`, `refers to unknown account "${toAccountId}"`);
    if (toAccountId === accountId) fail(`${p}.toAccountId`, "must differ from accountId");
    return toAccountId;
  };
  // Transfers are neither income nor expense, so they never carry a private/business split.
  const shares = (o: Obj, p: string, type: string, amount: number, isSplit: boolean, accountId: string) =>
    type === "TRANSFER"
      ? { isSplit: false, businessSharePct: 0, businessAmount: 0 }
      : { isSplit, ...splitShares(o, p, amount, isSplit, accountScope.get(accountId)!) };
  const categoryRef = (o: Obj, p: string) => {
    const id = optRef(o, "categoryId", p);
    if (id !== null && !categoryIds.has(id)) fail(`${p}.categoryId`, `refers to unknown folder "${id}"`);
    return id;
  };

  // Recurring rules
  const ruleIds = new Set<string>();
  const ruleFrequency = new Map<string, Frequency>();
  const recurringRules: BackupRecurringRule[] = asArray(root.recurringRules, "recurringRules").map((v, i) => {
    const p = `recurringRules[${i}]`;
    const o = asObject(v, p);
    const id = uniqueId(o, p, ruleIds);
    const accountId = accountRef(o, p);
    const amount = num(o, "amount", p, { min: 0.01 });
    const isSplit = bool(o, "isSplit", false);
    const frequency = oneOf(o, "frequency", FREQUENCIES, p);
    ruleFrequency.set(id, frequency);
    const startDate = date(o, "startDate", p, true)!;
    const endDate = date(o, "endDate", p, false);
    if (endDate && endDate < startDate) fail(`${p}.endDate`, "is before startDate");
    const active = bool(o, "active", true);
    const type = oneOf(o, "type", TX_TYPES, p);
    return {
      id,
      accountId,
      toAccountId: transferTarget(o, p, type, accountId),
      categoryId: categoryRef(o, p),
      type,
      amount,
      description: str(o, "description", p, { max: 500 }),
      frequency,
      startDate,
      endDate,
      ...shares(o, p, type, amount, isSplit, accountId),
      active,
      pausedSince: active ? null : date(o, "pausedSince", p, false),
      createdAt: timestamp(o, "createdAt") ?? "",
    };
  });

  // Skips
  const skipKeys = new Set<string>();
  const recurringSkips: BackupRecurringSkip[] = [];
  asArray(root.recurringSkips, "recurringSkips").forEach((v, i) => {
    const p = `recurringSkips[${i}]`;
    const o = asObject(v, p);
    const ruleId = str(o, "ruleId", p, { max: 100 });
    if (!ruleIds.has(ruleId)) fail(`${p}.ruleId`, `refers to unknown recurring rule "${ruleId}"`);
    const period = str(o, "period", p, { max: 20 });
    const key = `${ruleId}|${period}`;
    if (!skipKeys.has(key)) {
      skipKeys.add(key);
      recurringSkips.push({ ruleId, period });
    }
  });

  // Transactions
  const txIds = new Set<string>();
  const rulePeriods = new Set<string>();
  const transactions: BackupTransaction[] = asArray(root.transactions, "transactions").map((v, i) => {
    const p = `transactions[${i}]`;
    const o = asObject(v, p);
    const id = uniqueId(o, p, txIds);
    const accountId = accountRef(o, p);
    const amount = num(o, "amount", p, { min: 0.01 });
    const isSplit = bool(o, "isSplit", false);

    let recurringRuleId = optRef(o, "recurringRuleId", p);
    let recurringPeriod = typeof o.recurringPeriod === "string" && o.recurringPeriod ? o.recurringPeriod : null;
    if (recurringRuleId !== null && !ruleIds.has(recurringRuleId)) {
      fail(`${p}.recurringRuleId`, `refers to unknown recurring rule "${recurringRuleId}"`);
    }
    // One entry per rule and period; extra links become normal transactions.
    if (recurringRuleId && recurringPeriod) {
      const key = `${recurringRuleId}|${recurringPeriod}`;
      if (rulePeriods.has(key)) recurringRuleId = null;
      else rulePeriods.add(key);
    }
    if (!recurringRuleId || !recurringPeriod) {
      recurringRuleId = null;
      recurringPeriod = null;
    }

    const type = oneOf(o, "type", TX_TYPES, p);

    return {
      id,
      accountId,
      toAccountId: transferTarget(o, p, type, accountId),
      categoryId: categoryRef(o, p),
      type,
      amount,
      description: str(o, "description", p, { max: 500 }),
      notes: str(o, "notes", p, { max: 5000, allowEmpty: true, fallback: "" }),
      date: date(o, "date", p, true)!,
      ...shares(o, p, type, amount, isSplit, accountId),
      recurringRuleId,
      recurringPeriod,
      recurringModified: recurringRuleId ? bool(o, "recurringModified", false) : false,
      createdAt: timestamp(o, "createdAt") ?? "",
    };
  });

  return {
    format: BACKUP_FORMAT,
    version,
    exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : "",
    user: { currency },
    accounts,
    categories,
    recurringRules,
    recurringSkips,
    transactions,
  };
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

/** Inserts rows in chunks with multi-row VALUES lists. */
async function insertMany(q: QueryFn, table: string, columns: string[], rows: unknown[][]) {
  const chunkSize = Math.max(1, Math.floor(5000 / columns.length));
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await q(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
}

/** Replaces the user's entire workspace with the (already validated) backup. */
export async function importUserData(userId: string, data: BackupFile): Promise<ImportSummary> {
  const accountMap = new Map(data.accounts.map((a) => [a.id, randomUUID()]));
  const categoryMap = new Map(data.categories.map((c) => [c.id, randomUUID()]));
  const ruleMap = new Map(data.recurringRules.map((r) => [r.id, randomUUID()]));
  const catRef = (id: string | null) => (id === null ? null : categoryMap.get(id)!);
  const ts = (v: string) => v || new Date().toISOString();

  await withTransaction(async (q) => {
    await q(`DELETE FROM transactions WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM recurring_rules WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM categories WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM accounts WHERE user_id = $1`, [userId]);

    await insertMany(
      q,
      "accounts",
      ["id", "user_id", "name", "type", "scope", "initial_balance", "color", "icon", "created_at"],
      data.accounts.map((a) => [
        accountMap.get(a.id), userId, a.name, a.type, a.scope, a.initialBalance, a.color, a.icon, ts(a.createdAt),
      ])
    );

    // Folders first without parents, then link parents (avoids ordering issues).
    await insertMany(
      q,
      "categories",
      ["id", "user_id", "parent_id", "name", "color", "icon", "sort_order", "created_at"],
      data.categories.map((c) => [
        categoryMap.get(c.id), userId, null, c.name, c.color, c.icon, c.sortOrder, ts(c.createdAt),
      ])
    );
    for (const c of data.categories) {
      if (c.parentId !== null) {
        await q(`UPDATE categories SET parent_id = $1 WHERE id = $2`, [catRef(c.parentId), categoryMap.get(c.id)]);
      }
    }

    await insertMany(
      q,
      "recurring_rules",
      [
        "id", "user_id", "account_id", "category_id", "type", "amount", "description", "frequency",
        "start_date", "end_date", "next_run_date", "is_split", "business_share_pct", "business_amount",
        "active", "paused_since", "created_at", "to_account_id",
      ],
      data.recurringRules.map((r) => [
        ruleMap.get(r.id), userId, accountMap.get(r.accountId), catRef(r.categoryId), r.type, r.amount,
        r.description, r.frequency, r.startDate, r.endDate, r.startDate, r.isSplit, r.businessSharePct,
        r.businessAmount, r.active, r.active ? null : r.pausedSince, ts(r.createdAt),
        r.toAccountId ? accountMap.get(r.toAccountId) : null,
      ])
    );

    await insertMany(
      q,
      "recurring_skips",
      ["rule_id", "period"],
      data.recurringSkips.map((s) => [ruleMap.get(s.ruleId), s.period])
    );

    await insertMany(
      q,
      "transactions",
      [
        "id", "user_id", "account_id", "category_id", "type", "amount", "description", "notes", "date",
        "is_split", "business_share_pct", "business_amount", "recurring_rule_id", "recurring_period",
        "recurring_modified", "created_at", "to_account_id",
      ],
      data.transactions.map((t) => [
        randomUUID(), userId, accountMap.get(t.accountId), catRef(t.categoryId), t.type, t.amount,
        t.description, t.notes, t.date, t.isSplit, t.businessSharePct, t.businessAmount,
        t.recurringRuleId ? ruleMap.get(t.recurringRuleId) : null, t.recurringPeriod,
        t.recurringModified, ts(t.createdAt), t.toAccountId ? accountMap.get(t.toAccountId) : null,
      ])
    );

    await q(`UPDATE users SET currency = $1 WHERE id = $2`, [data.user.currency, userId]);
  });

  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    recurringRules: data.recurringRules.length,
    transactions: data.transactions.length,
  };
}
