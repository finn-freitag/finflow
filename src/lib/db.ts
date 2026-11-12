import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import path from "path";
import fs from "fs";
import { hashPassword } from "./crypto";
import { Frequency, occurrencesUntil, periodKey } from "./recurring-schedule";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __finflowPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __finflowPglite: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __finflowInitPromise: Promise<void> | undefined;
}

function isPostgresUrl(url?: string): boolean {
  return Boolean(url && (url.startsWith("postgres://") || url.startsWith("postgresql://")));
}

export type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

function getPool(): Pool {
  if (!global.__finflowPool) {
    global.__finflowPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return global.__finflowPool;
}

async function getPglite(): Promise<PGlite> {
  if (!global.__finflowPglite) {
    const dataDir = path.join(process.cwd(), "data", "pglite");
    fs.mkdirSync(dataDir, { recursive: true });
    global.__finflowPglite = new PGlite(dataDir);
  }
  await global.__finflowPglite.waitReady;
  return global.__finflowPglite;
}

const rawQuery: QueryFn = async <T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> => {
  if (isPostgresUrl(process.env.DATABASE_URL)) {
    const res = await getPool().query(text, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }
  const db = await getPglite();
  const res = await db.query<T>(text, params);
  return {
    rows: res.rows,
    rowCount: res.affectedRows ?? res.rows.length,
  };
};

/** Runs `fn` inside a database transaction (BEGIN/COMMIT, ROLLBACK on error). */
async function rawTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  if (isPostgresUrl(process.env.DATABASE_URL)) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const q: QueryFn = async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        const res = await client.query(text, params);
        return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
      };
      const result = await fn(q);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  const db = await getPglite();
  return db.transaction(async (tx) => {
    const q: QueryFn = async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const res = await tx.query<R>(text, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    };
    return fn(q);
  });
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'USER',
  oidc_sub TEXT UNIQUE,
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'CHECKING',
  scope TEXT NOT NULL DEFAULT 'PRIVATE',
  initial_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#4f46e5',
  icon TEXT NOT NULL DEFAULT 'wallet',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT NOT NULL DEFAULT 'folder',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('EXPENSE', 'INCOME')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  is_split BOOLEAN NOT NULL DEFAULT FALSE,
  business_share_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (business_share_pct >= 0 AND business_share_pct <= 100),
  business_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (business_amount >= 0),
  recurring_rule_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('EXPENSE', 'INCOME')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  next_run_date DATE NOT NULL,
  is_split BOOLEAN NOT NULL DEFAULT FALSE,
  business_share_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (business_share_pct >= 0 AND business_share_pct <= 100),
  business_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (business_amount >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS paused_since DATE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_period TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_modified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS recurring_skips (
  rule_id UUID NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, period)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_rule ON transactions(recurring_rule_id);
`;

// Created after the recurring migration below, which removes legacy duplicates first.
const RULE_PERIOD_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_rule_period
  ON transactions(recurring_rule_id, recurring_period)
  WHERE recurring_rule_id IS NOT NULL AND recurring_period IS NOT NULL
`;

interface LegacyRuleRow {
  id: string;
  account_id: string;
  category_id: string | null;
  type: string;
  amount: string;
  description: string;
  frequency: Frequency;
  start_date: string;
}

interface LegacyTxRow {
  id: string;
  account_id: string;
  category_id: string | null;
  type: string;
  amount: string;
  description: string;
  notes: string;
  date: string;
}

/**
 * One-time migration to the period-based recurring model:
 * - every auto-generated transaction gets the period key of its rule,
 * - duplicates created by the old engine are cleaned up (untouched copies are deleted,
 *   hand-edited copies are kept as normal transactions),
 * - entries that differ from what the rule would generate are flagged as hand-edited,
 * - rules that were auto-deactivated after their end date are reactivated (an ended rule is
 *   now derived from end_date; `active = false` only means "paused by the user").
 */
async function migrateRecurringV2(q: QueryFn): Promise<Record<string, number>> {
  const stats = { linked: 0, duplicatesDeleted: 0, duplicatesDetached: 0, markedEdited: 0, danglingDetached: 0 };

  const dangling = await q(
    `UPDATE transactions SET recurring_rule_id = NULL
     WHERE recurring_rule_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM recurring_rules r WHERE r.id = transactions.recurring_rule_id)`
  );
  stats.danglingDetached = dangling.rowCount;

  await q(
    `UPDATE recurring_rules SET active = TRUE
     WHERE active = FALSE AND end_date IS NOT NULL AND next_run_date > end_date`
  );
  await q(
    `UPDATE recurring_rules SET paused_since = LEAST(next_run_date, CURRENT_DATE)
     WHERE active = FALSE AND paused_since IS NULL`
  );

  const rules = await q<LegacyRuleRow>(
    `SELECT id, account_id, category_id, type, amount::text AS amount, description, frequency,
            to_char(start_date, 'YYYY-MM-DD') AS start_date
     FROM recurring_rules`
  );

  for (const rule of rules.rows) {
    const txRes = await q<LegacyTxRow>(
      `SELECT id, account_id, category_id, type, amount::text AS amount, description, notes,
              to_char(date, 'YYYY-MM-DD') AS date
       FROM transactions
       WHERE recurring_rule_id = $1 AND recurring_period IS NULL
       ORDER BY created_at ASC`,
      [rule.id]
    );
    if (txRes.rows.length === 0) continue;

    const maxDate = txRes.rows.reduce((m, t) => (t.date > m ? t.date : m), rule.start_date);
    const scheduledByPeriod = new Map<string, string>();
    for (const d of occurrencesUntil(rule.start_date, rule.frequency, maxDate)) {
      scheduledByPeriod.set(periodKey(d, rule.frequency), d);
    }

    // Content still exactly what the rule generates (the user never edited it).
    const isUntouchedContent = (t: LegacyTxRow) =>
      t.notes.startsWith("Auto-generated") &&
      Number(t.amount) === Number(rule.amount) &&
      t.account_id === rule.account_id &&
      t.category_id === rule.category_id &&
      t.type === rule.type &&
      t.description === rule.description;
    const isOnSchedule = (t: LegacyTxRow, key: string) => scheduledByPeriod.get(key) === t.date;

    const groups = new Map<string, LegacyTxRow[]>();
    for (const t of txRes.rows) {
      const key = periodKey(t.date, rule.frequency);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    for (const [key, rows] of groups) {
      // Keep (1) a row with hand-edited content, else (2) the row on the scheduled date,
      // else (3) the oldest row. Rows are already ordered oldest first; sort is stable.
      const rank = (t: LegacyTxRow) => (!isUntouchedContent(t) ? 0 : isOnSchedule(t, key) ? 1 : 2);
      const [keep, ...extras] = [...rows].sort((a, b) => rank(a) - rank(b));
      const keepEdited = !isUntouchedContent(keep) || !isOnSchedule(keep, key);
      await q(
        `UPDATE transactions SET recurring_period = $1, recurring_modified = $2 WHERE id = $3`,
        [key, keepEdited, keep.id]
      );
      stats.linked++;
      if (keepEdited) stats.markedEdited++;

      for (const extra of extras) {
        if (isUntouchedContent(extra)) {
          // A surplus auto-generated copy for a period that is already covered.
          await q(`DELETE FROM transactions WHERE id = $1`, [extra.id]);
          stats.duplicatesDeleted++;
        } else {
          // Hand-edited: never delete user data, keep it as a normal transaction.
          await q(
            `UPDATE transactions SET recurring_rule_id = NULL, recurring_period = NULL, recurring_modified = FALSE
             WHERE id = $1`,
            [extra.id]
          );
          stats.duplicatesDetached++;
        }
      }
    }
  }

  return stats;
}

async function initializeDatabase(): Promise<void> {
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await rawQuery(stmt);
  }

  const migrated = await rawQuery(
    `SELECT 1 FROM system_settings WHERE key = 'migration_recurring_v2'`
  );
  if (migrated.rows.length === 0) {
    const stats = await rawTransaction(async (q) => {
      const result = await migrateRecurringV2(q);
      await q(
        `INSERT INTO system_settings (key, value) VALUES ('migration_recurring_v2', $1)
         ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify({ ...result, at: new Date().toISOString() })]
      );
      return result;
    });
    console.log("[finflow] Migrated recurring transactions to period model:", stats);
  }
  await rawQuery(RULE_PERIOD_UNIQUE_INDEX_SQL);

  // Seed default system settings if not present
  const defaultSettings: Record<string, string> = {
    allow_registration: process.env.ALLOW_REGISTRATION === "true" ? "true" : "false",
    auth_mode: process.env.AUTH_MODE || "both",
    oidc_issuer: process.env.OIDC_ISSUER || "",
    oidc_client_id: process.env.OIDC_CLIENT_ID || "",
    oidc_client_secret: process.env.OIDC_CLIENT_SECRET || "",
    oidc_redirect_uri:
      process.env.OIDC_REDIRECT_URI ||
      `${process.env.APP_URL || "http://localhost:3000"}/api/auth/oidc/callback`,
    oidc_provider_name: process.env.OIDC_PROVIDER_NAME || "Single Sign-On (OIDC)",
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    await rawQuery(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  // Optional automatic Admin seeding via environment variables on first launch
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  const adminName = process.env.ADMIN_NAME?.trim() || "Administrator";

  if (adminEmail && adminPassword) {
    const countRes = await rawQuery<{ count: string }>(`SELECT COUNT(*)::text as count FROM users`);
    const userCount = parseInt(countRes.rows[0]?.count || "0", 10);
    if (userCount === 0) {
      const passwordHash = hashPassword(adminPassword);
      const userRes = await rawQuery<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, role, currency)
         VALUES ($1, $2, $3, 'ADMIN', 'EUR')
         RETURNING id`,
        [adminEmail, adminName, passwordHash]
      );
      if (userRes.rows[0]?.id) {
        await seedDefaultUserWorkspace(userRes.rows[0].id, true);
      }
    }
  }
}

export async function ensureDb(): Promise<void> {
  if (!global.__finflowInitPromise) {
    global.__finflowInitPromise = initializeDatabase().catch((err) => {
      global.__finflowInitPromise = undefined;
      throw err;
    });
  }
  await global.__finflowInitPromise;
}

/** Runs `fn` inside a database transaction. */
export async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  await ensureDb();
  return rawTransaction(fn);
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  await ensureDb();
  return rawQuery<T>(text, params);
}

/**
 * Seeds a newly created user with sensible Private & Business accounts,
 * a multi-level Category Tree (folders & subfolders), and optional demo transactions.
 */
export async function seedDefaultUserWorkspace(
  userId: string,
  includeDemoTransactions = false
): Promise<void> {
  // 1. Create Default Accounts (Private & Business)
  const privCheckRes = await rawQuery<{ id: string }>(
    `INSERT INTO accounts (user_id, name, type, scope, initial_balance, color, icon)
     VALUES ($1, 'Personal Checking', 'CHECKING', 'PRIVATE', 2450.00, '#4f46e5', 'landmark')
     RETURNING id`,
    [userId]
  );
  const privCardRes = await rawQuery<{ id: string }>(
    `INSERT INTO accounts (user_id, name, type, scope, initial_balance, color, icon)
     VALUES ($1, 'Personal Credit Card', 'CREDIT_CARD', 'PRIVATE', 0.00, '#ec4899', 'credit-card')
     RETURNING id`,
    [userId]
  );
  const bizBankRes = await rawQuery<{ id: string }>(
    `INSERT INTO accounts (user_id, name, type, scope, initial_balance, color, icon)
     VALUES ($1, 'Business Operating Account', 'CHECKING', 'BUSINESS', 5800.00, '#0ea5e9', 'briefcase')
     RETURNING id`,
    [userId]
  );
  await rawQuery(
    `INSERT INTO accounts (user_id, name, type, scope, initial_balance, color, icon)
     VALUES ($1, 'Cash Wallet', 'CASH', 'PRIVATE', 150.00, '#10b981', 'wallet')`,
    [userId]
  );

  const privCheckingId = privCheckRes.rows[0].id;
  const privCardId = privCardRes.rows[0].id;
  const bizAccountId = bizBankRes.rows[0].id;

  // 2. Create Category Tree with Subfolders
  // Top-level folder: Housing & Utilities
  const housingRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, NULL, 'Housing & Utilities', '#6366f1', 'home', 1) RETURNING id`,
    [userId]
  );
  const housingId = housingRes.rows[0].id;

  const rentRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Rent & Mortgage', '#6366f1', 'key', 1) RETURNING id`,
    [userId, housingId]
  );
  const utilitiesRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Utilities', '#818cf8', 'zap', 2) RETURNING id`,
    [userId, housingId]
  );
  const internetRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Internet & Mobile', '#a5b4fc', 'wifi', 1) RETURNING id`,
    [userId, utilitiesRes.rows[0].id]
  );

  // Top-level folder: Food & Living
  const foodRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, NULL, 'Food & Dining', '#f59e0b', 'utensils', 2) RETURNING id`,
    [userId]
  );
  const groceriesRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Groceries', '#fbbf24', 'shopping-cart', 1) RETURNING id`,
    [userId, foodRes.rows[0].id]
  );
  const restaurantsRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Restaurants & Business Meals', '#f97316', 'coffee', 2) RETURNING id`,
    [userId, foodRes.rows[0].id]
  );

  // Top-level folder: Business & Operations
  const bizFolderRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, NULL, 'Work & Operations', '#0ea5e9', 'briefcase', 3) RETURNING id`,
    [userId]
  );
  const softwareRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Software & Cloud', '#38bdf8', 'cpu', 1) RETURNING id`,
    [userId, bizFolderRes.rows[0].id]
  );
  const hardwareRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Equipment & Hardware', '#0284c7', 'laptop', 2) RETURNING id`,
    [userId, bizFolderRes.rows[0].id]
  );

  // Top-level folder: Transportation
  const transportRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, NULL, 'Transportation', '#ec4899', 'car', 4) RETURNING id`,
    [userId]
  );
  const fuelRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Fuel & Charging', '#f472b6', 'fuel', 1) RETURNING id`,
    [userId, transportRes.rows[0].id]
  );

  // Top-level folder: Income & Revenue
  const incomeFolderRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, NULL, 'Income & Revenue', '#10b981', 'trending-up', 5) RETURNING id`,
    [userId]
  );
  const salaryRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Salary & Wages', '#34d399', 'wallet', 1) RETURNING id`,
    [userId, incomeFolderRes.rows[0].id]
  );
  const clientRevRes = await rawQuery<{ id: string }>(
    `INSERT INTO categories (user_id, parent_id, name, color, icon, sort_order)
     VALUES ($1, $2, 'Client Invoices', '#059669', 'file-text', 2) RETURNING id`,
    [userId, incomeFolderRes.rows[0].id]
  );

  if (!includeDemoTransactions) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prevMonthNum = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevMonthYear = now.getMonth() === 0 ? year - 1 : year;
  const prevMonth = String(prevMonthNum).padStart(2, "0");

  // Seed realistic sample transactions showing hierarchy rollups, accounts, and Private/Business splits
  const sampleTransactions = [
    // Current month income
    {
      accountId: privCheckingId,
      categoryId: salaryRes.rows[0].id,
      type: "INCOME",
      amount: 3600.0,
      description: "Monthly Net Salary",
      notes: "Primary employment salary",
      date: `${year}-${month}-01`,
      isSplit: false,
      businessPct: 0,
      businessAmt: 0,
    },
    {
      accountId: bizAccountId,
      categoryId: clientRevRes.rows[0].id,
      type: "INCOME",
      amount: 2400.0,
      description: "Invoice #2026-14 — Web Consulting",
      notes: "Q4 Architecture retainer",
      date: `${year}-${month}-03`,
      isSplit: false,
      businessPct: 100,
      businessAmt: 2400.0,
    },
    // Current month expenses (including split private/business!)
    {
      accountId: privCheckingId,
      categoryId: rentRes.rows[0].id,
      type: "EXPENSE",
      amount: 1250.0,
      description: "Apartment Rent (incl. Home Office Room)",
      notes: "20% dedicated home office space deductible as business expense",
      date: `${year}-${month}-01`,
      isSplit: true,
      businessPct: 20,
      businessAmt: 250.0,
    },
    {
      accountId: privCheckingId,
      categoryId: internetRes.rows[0].id,
      type: "EXPENSE",
      amount: 80.0,
      description: "Fiber Internet & Unlimited Mobile Plan",
      notes: "Split 50% Private / 50% Business",
      date: `${year}-${month}-04`,
      isSplit: true,
      businessPct: 50,
      businessAmt: 40.0,
    },
    {
      accountId: privCheckingId,
      categoryId: utilitiesRes.rows[0].id,
      type: "EXPENSE",
      amount: 110.0,
      description: "Municipal Electricity & Water",
      notes: "Direct expense in Utilities parent folder",
      date: `${year}-${month}-05`,
      isSplit: false,
      businessPct: 0,
      businessAmt: 0,
    },
    {
      accountId: privCardId,
      categoryId: groceriesRes.rows[0].id,
      type: "EXPENSE",
      amount: 285.4,
      description: "Weekly Supermarket Groceries",
      notes: "Household food & supplies",
      date: `${year}-${month}-06`,
      isSplit: false,
      businessPct: 0,
      businessAmt: 0,
    },
    {
      accountId: bizAccountId,
      categoryId: restaurantsRes.rows[0].id,
      type: "EXPENSE",
      amount: 94.0,
      description: "Client Lunch Meeting",
      notes: "Paid via Business Operating Account",
      date: `${year}-${month}-07`,
      isSplit: false,
      businessPct: 100,
      businessAmt: 94.0,
    },
    {
      accountId: bizAccountId,
      categoryId: softwareRes.rows[0].id,
      type: "EXPENSE",
      amount: 69.0,
      description: "Cloud Hosting & GitHub Copilot",
      notes: "Monthly SaaS subscriptions",
      date: `${year}-${month}-08`,
      isSplit: false,
      businessPct: 100,
      businessAmt: 69.0,
    },
    {
      accountId: privCardId,
      categoryId: hardwareRes.rows[0].id,
      type: "EXPENSE",
      amount: 420.0,
      description: "4K USB-C Monitor",
      notes: "Bought with personal card, 75% used for business",
      date: `${year}-${month}-09`,
      isSplit: true,
      businessPct: 75,
      businessAmt: 315.0,
    },
    {
      accountId: privCardId,
      categoryId: fuelRes.rows[0].id,
      type: "EXPENSE",
      amount: 120.0,
      description: "Fuel & Highway Tolls",
      notes: "30% client site visit mileage",
      date: `${year}-${month}-10`,
      isSplit: true,
      businessPct: 30,
      businessAmt: 36.0,
    },
    // Previous month transactions for multi-month chart trends
    {
      accountId: privCheckingId,
      categoryId: salaryRes.rows[0].id,
      type: "INCOME",
      amount: 3600.0,
      description: "Monthly Net Salary",
      notes: "",
      date: `${prevMonthYear}-${prevMonth}-01`,
      isSplit: false,
      businessPct: 0,
      businessAmt: 0,
    },
    {
      accountId: bizAccountId,
      categoryId: clientRevRes.rows[0].id,
      type: "INCOME",
      amount: 1950.0,
      description: "Invoice #2026-11 — UI Audit",
      notes: "",
      date: `${prevMonthYear}-${prevMonth}-12`,
      isSplit: false,
      businessPct: 100,
      businessAmt: 1950.0,
    },
    {
      accountId: privCheckingId,
      categoryId: rentRes.rows[0].id,
      type: "EXPENSE",
      amount: 1250.0,
      description: "Apartment Rent (incl. Home Office Room)",
      notes: "",
      date: `${prevMonthYear}-${prevMonth}-01`,
      isSplit: true,
      businessPct: 20,
      businessAmt: 250.0,
    },
    {
      accountId: privCardId,
      categoryId: groceriesRes.rows[0].id,
      type: "EXPENSE",
      amount: 340.0,
      description: "Monthly Groceries",
      notes: "",
      date: `${prevMonthYear}-${prevMonth}-15`,
      isSplit: false,
      businessPct: 0,
      businessAmt: 0,
    },
  ];

  // Salary, rent and cloud hosting are booked by the recurring rules seeded below.
  const bookedByRules = new Set([
    "Monthly Net Salary",
    "Apartment Rent (incl. Home Office Room)",
    "Cloud Hosting & GitHub Copilot",
  ]);

  for (const tx of sampleTransactions.filter((t) => !bookedByRules.has(t.description))) {
    await rawQuery(
      `INSERT INTO transactions
        (user_id, account_id, category_id, type, amount, description, notes, date, is_split, business_share_pct, business_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        userId,
        tx.accountId,
        tx.categoryId,
        tx.type,
        tx.amount,
        tx.description,
        tx.notes,
        tx.date,
        tx.isSplit,
        tx.businessPct,
        tx.businessAmt,
      ]
    );
  }

  // 3. Seed sample recurring rules
  // Rules start last month, so the first workspace load books last and this month's entries.
  const rulesStart = `${prevMonthYear}-${prevMonth}-01`;
  const fiveYearEndDate = `${prevMonthYear + 5}-${prevMonth}-01`;
  await rawQuery(
    `INSERT INTO recurring_rules
      (user_id, account_id, category_id, type, amount, description, frequency, start_date, end_date, next_run_date, is_split, business_share_pct, business_amount, active)
     VALUES
      ($1, $2, $3, 'EXPENSE', 1250.00, 'Apartment Rent (20% Home Office)', 'MONTHLY', $4, $8, $9, TRUE, 20, 250.00, TRUE),
      ($1, $5, $6, 'EXPENSE', 69.00, 'Cloud Hosting & GitHub Copilot', 'MONTHLY', $4, NULL, $9, FALSE, 100, 69.00, TRUE),
      ($1, $2, $7, 'INCOME', 3600.00, 'Monthly Net Salary', 'MONTHLY', $4, NULL, $9, FALSE, 0, 0.00, TRUE)`,
    [
      userId,
      privCheckingId,
      rentRes.rows[0].id,
      rulesStart,
      bizAccountId,
      softwareRes.rows[0].id,
      salaryRes.rows[0].id,
      fiveYearEndDate,
      rulesStart,
    ]
  );
}
