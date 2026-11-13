export type ScopeFilter = "ALL" | "PRIVATE" | "BUSINESS";
export type PeriodMode = "MONTH" | "YEAR" | "ALL";

export interface AccountItem {
  id: string;
  name: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH" | "INVESTMENT";
  scope: "PRIVATE" | "BUSINESS";
  initialBalance: number;
  color: string;
  icon: string;
}

export interface CategoryItem {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
}

export interface TransactionItem {
  id: string;
  accountId: string;
  /** Destination account of a transfer (money moves from accountId to toAccountId). */
  toAccountId?: string | null;
  categoryId: string | null;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number;
  description: string;
  notes: string;
  date: string; // YYYY-MM-DD
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
  recurringRuleId?: string | null;
  recurringModified?: boolean;
}

export interface RecurringRuleItem {
  id: string;
  accountId: string;
  /** Destination account of a recurring transfer. */
  toAccountId?: string | null;
  categoryId: string | null;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number;
  description: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
  active: boolean;
  pausedSince?: string | null;
}

export interface CategoryTreeNode {
  id: string | null; // null represents Root
  parentId: string | null;
  name: string;
  color: string;
  icon: string;
  depth: number;
  pathNames: string[];
  children: CategoryTreeNode[];
  // Direct numbers (transactions directly inside this folder)
  directExpense: number;
  directIncome: number;
  directNet: number;
  directTransactionCount: number;
  // Recursive numbers (this folder + all descendant subfolders)
  totalExpense: number;
  totalIncome: number;
  totalNet: number;
  privateExpense: number;
  businessExpense: number;
  privateIncome: number;
  businessIncome: number;
  totalTransactionCount: number;
  // All-time recursive net sum (ignoring month/year filter, respecting Scope & Account filter)
  allTimeNet: number;
  allTimeExpense: number;
  allTimeIncome: number;
  /** Excluded by the user: its totals are not added to its parent folders. */
  excluded: boolean;
  /** Lies inside an excluded folder. */
  insideExcluded: boolean;
}

/** Accounts in view: "ALL", or the IDs of the selected accounts. */
export type AccountFilter = "ALL" | readonly string[];

export function isAccountInFilter(filter: AccountFilter, accountId: string | null | undefined): boolean {
  return filter === "ALL" || (!!accountId && filter.includes(accountId));
}

/**
 * Whether a transaction belongs to the accounts in view: its own account, or either side of a
 * transfer.
 */
export function transactionTouchesAccount(tx: TransactionItem, filter: AccountFilter): boolean {
  return isAccountInFilter(filter, tx.accountId) || isAccountInFilter(filter, tx.toAccountId);
}

/**
 * Direction of a transfer relative to the accounts in view: "OUT" when it leaves them, "IN" when
 * it arrives from outside, null when both or neither side is in view (or it is no transfer).
 */
export function transferDirection(tx: TransactionItem, filter: AccountFilter): "OUT" | "IN" | null {
  if (tx.type !== "TRANSFER") return null;
  const fromIn = isAccountInFilter(filter, tx.accountId);
  const toIn = isAccountInFilter(filter, tx.toAccountId);
  if (fromIn === toIn) return null;
  return fromIn ? "OUT" : "IN";
}

/**
 * Change of an account's balance caused by a transaction: income adds, expenses subtract, and a
 * transfer subtracts from its source account and adds to its destination account.
 */
export function balanceEffect(tx: TransactionItem, accountId: string): number {
  if (tx.type === "TRANSFER") {
    if (tx.accountId === accountId) return -tx.amount;
    if (tx.toAccountId === accountId) return tx.amount;
    return 0;
  }
  if (tx.accountId !== accountId) return 0;
  return tx.type === "INCOME" ? tx.amount : -tx.amount;
}

/**
 * How a transaction counts as income or expense in the current view, or null if it doesn't.
 *
 * Income and expenses count for their own account. A transfer only moves money between the
 * user's accounts, so when both of its accounts are in view (always with "all accounts") it
 * counts as neither (otherwise both the income and the expense side would grow although no money
 * came in or went out). When only one side is in view it is real money for the viewed accounts:
 * an expense when it leaves them, income when it arrives. It has no private/business split, so it
 * belongs entirely to the scope of the account in view.
 */
export function viewedAmounts(
  tx: TransactionItem,
  scopeFilter: ScopeFilter,
  accountFilter: AccountFilter,
  accountScopes: Map<string, AccountItem["scope"]>
): { kind: "EXPENSE" | "INCOME"; effectiveAmount: number; privateAmount: number; businessAmount: number } | null {
  if (tx.type === "TRANSFER") {
    const direction = transferDirection(tx, accountFilter);
    if (!direction) return null;
    const kind = direction === "OUT" ? "EXPENSE" : "INCOME";
    const viewedAccountId = direction === "OUT" ? tx.accountId : tx.toAccountId ?? "";
    const isBusiness = accountScopes.get(viewedAccountId) === "BUSINESS";
    const privateAmount = isBusiness ? 0 : tx.amount;
    const businessAmount = isBusiness ? tx.amount : 0;
    const effectiveAmount =
      scopeFilter === "PRIVATE" ? privateAmount : scopeFilter === "BUSINESS" ? businessAmount : tx.amount;
    return effectiveAmount > 0 ? { kind, effectiveAmount, privateAmount, businessAmount } : null;
  }

  if (!isAccountInFilter(accountFilter, tx.accountId)) return null;
  const amounts = getEffectiveTransactionAmount(tx, scopeFilter);
  return amounts.effectiveAmount > 0 ? { kind: tx.type, ...amounts } : null;
}

export function getEffectiveTransactionAmount(
  tx: TransactionItem,
  scopeFilter: ScopeFilter
): {
  effectiveAmount: number;
  privateAmount: number;
  businessAmount: number;
} {
  const biz = Math.min(tx.amount, Math.max(0, Number(tx.businessAmount || 0)));
  const priv = Math.max(0, Math.round((tx.amount - biz) * 100) / 100);

  if (scopeFilter === "PRIVATE") {
    return { effectiveAmount: priv, privateAmount: priv, businessAmount: 0 };
  }
  if (scopeFilter === "BUSINESS") {
    return { effectiveAmount: biz, privateAmount: 0, businessAmount: biz };
  }
  return { effectiveAmount: tx.amount, privateAmount: priv, businessAmount: biz };
}

export function matchesPeriod(
  dateStr: string,
  periodMode: PeriodMode,
  selectedYear: number,
  selectedMonth: number // 1..12
): boolean {
  if (periodMode === "ALL") return true;
  const year = Number(dateStr.slice(0, 4));
  if (year !== selectedYear) return false;
  if (periodMode === "YEAR") return true;
  const month = Number(dateStr.slice(5, 7));
  return month === selectedMonth;
}

export function buildCategoryTreeWithSums(
  categories: CategoryItem[],
  transactions: TransactionItem[],
  options: {
    scopeFilter: ScopeFilter;
    periodMode: PeriodMode;
    selectedYear: number;
    selectedMonth: number;
    accountFilter: AccountFilter;
    /** Needed to give a transfer the scope of the viewed account. */
    accounts?: AccountItem[];
    /** Folders whose totals (including their subfolders) are left out of their parents. */
    excludedFolderIds?: ReadonlySet<string>;
  }
): {
  rootNode: CategoryTreeNode;
  nodeMap: Map<string | null, CategoryTreeNode>;
  flatNodes: CategoryTreeNode[];
} {
  const { scopeFilter, periodMode, selectedYear, selectedMonth, accountFilter } = options;
  const excludedFolderIds = options.excludedFolderIds ?? new Set<string>();
  const accountScopes = new Map((options.accounts ?? []).map((a) => [a.id, a.scope]));

  const nodeMap = new Map<string | null, CategoryTreeNode>();

  const rootNode: CategoryTreeNode = {
    id: null,
    parentId: null,
    name: "Root (All Categories)",
    color: "#6366f1",
    icon: "layers",
    depth: 0,
    pathNames: ["Root"],
    children: [],
    directExpense: 0,
    directIncome: 0,
    directNet: 0,
    directTransactionCount: 0,
    totalExpense: 0,
    totalIncome: 0,
    totalNet: 0,
    privateExpense: 0,
    businessExpense: 0,
    privateIncome: 0,
    businessIncome: 0,
    totalTransactionCount: 0,
    allTimeNet: 0,
    allTimeExpense: 0,
    allTimeIncome: 0,
    excluded: false,
    insideExcluded: false,
  };

  nodeMap.set(null, rootNode);

  for (const cat of categories) {
    nodeMap.set(cat.id, {
      id: cat.id,
      parentId: cat.parentId,
      name: cat.name,
      color: cat.color || "#6366f1",
      icon: cat.icon || "folder",
      depth: 1,
      pathNames: [],
      children: [],
      directExpense: 0,
      directIncome: 0,
      directNet: 0,
      directTransactionCount: 0,
      totalExpense: 0,
      totalIncome: 0,
      totalNet: 0,
      privateExpense: 0,
      businessExpense: 0,
      privateIncome: 0,
      businessIncome: 0,
      totalTransactionCount: 0,
      allTimeNet: 0,
      allTimeExpense: 0,
      allTimeIncome: 0,
      excluded: excludedFolderIds.has(cat.id),
      insideExcluded: false,
    });
  }

  // Link parent-child relationships
  for (const cat of categories) {
    const node = nodeMap.get(cat.id)!;
    const parent = (cat.parentId && nodeMap.get(cat.parentId)) || rootNode;
    parent.children.push(node);
  }

  // Assign depths and breadcrumb paths
  const flatNodes: CategoryTreeNode[] = [];
  function assignMetadata(node: CategoryTreeNode, depth: number, ancestorNames: string[], inExcluded: boolean) {
    node.depth = depth;
    node.pathNames = ancestorNames;
    node.insideExcluded = inExcluded;
    if (node.id !== null) {
      flatNodes.push(node);
    }
    for (const child of node.children) {
      assignMetadata(child, depth + 1, [...ancestorNames, child.name], inExcluded || node.excluded);
    }
  }
  assignMetadata(rootNode, 0, ["Root"], false);

  // Accumulate direct transactions onto each node
  for (const tx of transactions) {
    const targetNode =
      tx.categoryId && nodeMap.has(tx.categoryId) ? nodeMap.get(tx.categoryId)! : rootNode;

    const viewed = viewedAmounts(tx, scopeFilter, accountFilter, accountScopes);
    if (!viewed) {
      // A transfer between two accounts in view adds nothing to the sums, but is still listed
      // (and counted) in its folder.
      if (
        tx.type === "TRANSFER" &&
        transactionTouchesAccount(tx, accountFilter) &&
        matchesPeriod(tx.date, periodMode, selectedYear, selectedMonth)
      ) {
        targetNode.directTransactionCount += 1;
      }
      continue;
    }
    const { kind, effectiveAmount, privateAmount, businessAmount } = viewed;

    // 1. All-time direct accumulation ( transferred to recursive in post-order step )
    if (kind === "EXPENSE") {
      targetNode.allTimeExpense += effectiveAmount;
      targetNode.allTimeNet -= effectiveAmount;
    } else {
      targetNode.allTimeIncome += effectiveAmount;
      targetNode.allTimeNet += effectiveAmount;
    }

    // 2. Period-filtered direct accumulation
    if (matchesPeriod(tx.date, periodMode, selectedYear, selectedMonth)) {
      targetNode.directTransactionCount += 1;
      if (kind === "EXPENSE") {
        targetNode.directExpense += effectiveAmount;
        targetNode.directNet -= effectiveAmount;
        targetNode.privateExpense += privateAmount;
        targetNode.businessExpense += businessAmount;
      } else {
        targetNode.directIncome += effectiveAmount;
        targetNode.directNet += effectiveAmount;
        targetNode.privateIncome += privateAmount;
        targetNode.businessIncome += businessAmount;
      }
    }
  }

  // Post-order traversal to roll up recursive totals from children to parents & Root
  function rollUp(node: CategoryTreeNode) {
    node.totalExpense = node.directExpense;
    node.totalIncome = node.directIncome;
    node.totalNet = node.directNet;
    node.totalTransactionCount = node.directTransactionCount;

    for (const child of node.children) {
      rollUp(child);
      // An excluded folder keeps its own totals but adds nothing to its parents.
      if (child.excluded) continue;
      node.totalExpense += child.totalExpense;
      node.totalIncome += child.totalIncome;
      node.totalNet += child.totalNet;
      node.privateExpense += child.privateExpense;
      node.businessExpense += child.businessExpense;
      node.privateIncome += child.privateIncome;
      node.businessIncome += child.businessIncome;
      node.totalTransactionCount += child.totalTransactionCount;
      node.allTimeExpense += child.allTimeExpense;
      node.allTimeIncome += child.allTimeIncome;
      node.allTimeNet += child.allTimeNet;
    }

    // Round to 2 decimals to prevent floating point drift
    node.directExpense = Math.round(node.directExpense * 100) / 100;
    node.directIncome = Math.round(node.directIncome * 100) / 100;
    node.directNet = Math.round(node.directNet * 100) / 100;
    node.totalExpense = Math.round(node.totalExpense * 100) / 100;
    node.totalIncome = Math.round(node.totalIncome * 100) / 100;
    node.totalNet = Math.round(node.totalNet * 100) / 100;
    node.privateExpense = Math.round(node.privateExpense * 100) / 100;
    node.businessExpense = Math.round(node.businessExpense * 100) / 100;
    node.privateIncome = Math.round(node.privateIncome * 100) / 100;
    node.businessIncome = Math.round(node.businessIncome * 100) / 100;
    node.allTimeNet = Math.round(node.allTimeNet * 100) / 100;
    node.allTimeExpense = Math.round(node.allTimeExpense * 100) / 100;
    node.allTimeIncome = Math.round(node.allTimeIncome * 100) / 100;
  }

  rollUp(rootNode);

  return { rootNode, nodeMap, flatNodes };
}

/**
 * Returns the set of category IDs inside `selectedFolderId` (including itself and all descendants).
 * If `selectedFolderId === null` (Root), all categories match. With `skipExcluded`, excluded
 * subfolders (and everything inside them) are left out; the start folder itself always counts.
 */
export function getDescendantCategoryIds(
  selectedFolderId: string | null,
  nodeMap: Map<string | null, CategoryTreeNode>,
  skipExcluded = false
): Set<string | null> {
  const result = new Set<string | null>();
  const startNode = nodeMap.get(selectedFolderId) || nodeMap.get(null);
  if (!startNode) return result;

  function collect(n: CategoryTreeNode) {
    result.add(n.id);
    for (const c of n.children) {
      if (skipExcluded && c.excluded) continue;
      collect(c);
    }
  }
  collect(startNode);
  return result;
}

export interface FolderBreakdownSlice {
  id: string | null;
  name: string;
  color: string;
  expense: number;
  income: number;
  net: number;
  percentage: number;
  isDirectInCurrentFolder?: boolean;
  canDrillDown: boolean;
}

/**
 * Computes the spending/income breakdown per child folder for the active folder (`selectedFolderId`).
 * - If viewing Root (`null`), breaks down by each top-level folder (recursive sum) + direct Root transactions.
 * - If viewing a specific folder, breaks down by its immediate subfolders (recursive sum) + direct transactions in that folder.
 */
export function getFolderSpendingBreakdown(
  activeNode: CategoryTreeNode,
  mode: "EXPENSE" | "INCOME" = "EXPENSE"
): FolderBreakdownSlice[] {
  const items: FolderBreakdownSlice[] = [];
  const totalForMode = mode === "EXPENSE" ? activeNode.totalExpense : activeNode.totalIncome;

  for (const child of activeNode.children) {
    if (child.excluded) continue;
    const val = mode === "EXPENSE" ? child.totalExpense : child.totalIncome;
    if (val > 0 || child.totalTransactionCount > 0) {
      items.push({
        id: child.id,
        name: child.name,
        color: child.color,
        expense: child.totalExpense,
        income: child.totalIncome,
        net: child.totalNet,
        percentage: totalForMode > 0 ? Math.round((val / totalForMode) * 1000) / 10 : 0,
        canDrillDown: true,
      });
    }
  }

  const directVal = mode === "EXPENSE" ? activeNode.directExpense : activeNode.directIncome;
  if (directVal > 0) {
    items.push({
      id: activeNode.id,
      name:
        activeNode.id === null
          ? "Uncategorized (Root)"
          : `Direct in ${activeNode.name}`,
      color: "#64748b",
      expense: activeNode.directExpense,
      income: activeNode.directIncome,
      net: activeNode.directNet,
      percentage: totalForMode > 0 ? Math.round((directVal / totalForMode) * 1000) / 10 : 0,
      isDirectInCurrentFolder: true,
      canDrillDown: false,
    });
  }

  items.sort((a, b) =>
    mode === "EXPENSE" ? b.expense - a.expense : b.income - a.income
  );
  return items;
}

export interface MonthlyChartPoint {
  monthIndex: number; // 1..12
  label: string;
  expense: number;
  income: number;
  privateExpense: number;
  businessExpense: number;
  net: number;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function emptyPoint(monthIndex: number, label: string): MonthlyChartPoint {
  return { monthIndex, label, expense: 0, income: 0, privateExpense: 0, businessExpense: 0, net: 0 };
}

/** Adds every matching transaction to the point `pick` returns for its date (or skips it on null). */
function accumulateSeries(
  transactions: TransactionItem[],
  allowedCategoryIds: Set<string | null>,
  includeAllCategories: boolean,
  scopeFilter: ScopeFilter,
  accountFilter: AccountFilter,
  accountScopes: Map<string, AccountItem["scope"]>,
  pick: (date: string) => MonthlyChartPoint | null
) {
  for (const tx of transactions) {
    if (!includeAllCategories && !allowedCategoryIds.has(tx.categoryId)) continue;

    // Transfers count only when one side is out of view (see viewedAmounts).
    const viewed = viewedAmounts(tx, scopeFilter, accountFilter, accountScopes);
    if (!viewed) continue;

    const pt = pick(tx.date);
    if (!pt) continue;

    const { kind, effectiveAmount, privateAmount, businessAmount } = viewed;
    if (kind === "EXPENSE") {
      pt.expense = Math.round((pt.expense + effectiveAmount) * 100) / 100;
      pt.privateExpense = Math.round((pt.privateExpense + privateAmount) * 100) / 100;
      pt.businessExpense = Math.round((pt.businessExpense + businessAmount) * 100) / 100;
      pt.net = Math.round((pt.net - effectiveAmount) * 100) / 100;
    } else {
      pt.income = Math.round((pt.income + effectiveAmount) * 100) / 100;
      pt.net = Math.round((pt.net + effectiveAmount) * 100) / 100;
    }
  }
}

export function getYearlyMonthlySeries(
  transactions: TransactionItem[],
  year: number,
  allowedCategoryIds: Set<string | null>,
  includeAllCategories: boolean,
  scopeFilter: ScopeFilter,
  accountFilter: AccountFilter,
  accounts: AccountItem[] = []
): MonthlyChartPoint[] {
  const points = MONTH_LABELS.map((label, idx) => emptyPoint(idx + 1, label));
  accumulateSeries(
    transactions,
    allowedCategoryIds,
    includeAllCategories,
    scopeFilter,
    accountFilter,
    new Map(accounts.map((a) => [a.id, a.scope])),
    (date) => {
      if (Number(date.slice(0, 4)) !== year) return null;
      return points[Number(date.slice(5, 7)) - 1] ?? null;
    }
  );
  return points;
}

export interface YearlyChartPoint extends MonthlyChartPoint {
  year: number;
}

/**
 * One point per year, from the first year with any transaction up to the later of the last
 * such year and `currentYear`, so the axis stays the same when switching folders.
 */
export function getMultiYearSeries(
  transactions: TransactionItem[],
  currentYear: number,
  allowedCategoryIds: Set<string | null>,
  includeAllCategories: boolean,
  scopeFilter: ScopeFilter,
  accountFilter: AccountFilter,
  accounts: AccountItem[] = []
): YearlyChartPoint[] {
  let first = currentYear;
  let last = currentYear;
  for (const tx of transactions) {
    const y = Number(tx.date.slice(0, 4));
    if (!Number.isFinite(y) || y < 1970) continue;
    if (y < first) first = y;
    if (y > last) last = y;
  }

  const points: YearlyChartPoint[] = [];
  for (let y = first; y <= last; y++) {
    points.push({ ...emptyPoint(0, String(y)), year: y });
  }
  accumulateSeries(
    transactions,
    allowedCategoryIds,
    includeAllCategories,
    scopeFilter,
    accountFilter,
    new Map(accounts.map((a) => [a.id, a.scope])),
    (date) => points[Number(date.slice(0, 4)) - first] ?? null
  );
  return points;
}

/** Today's date as YYYY-MM-DD in the browser's local timezone (not UTC). */
export function localTodayYMD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatCurrency(amount: number, currency = "EUR", showPlus = false): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  if (showPlus && amount > 0) {
    return `+${formatted}`;
  }
  return formatted;
}
