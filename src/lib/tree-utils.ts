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
  categoryId: string | null;
  type: "EXPENSE" | "INCOME";
  amount: number;
  description: string;
  notes: string;
  date: string; // YYYY-MM-DD
  isSplit: boolean;
  businessSharePct: number;
  businessAmount: number;
  recurringRuleId?: string | null;
}

export interface RecurringRuleItem {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: "EXPENSE" | "INCOME";
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
    accountFilterId: string | "ALL";
  }
): {
  rootNode: CategoryTreeNode;
  nodeMap: Map<string | null, CategoryTreeNode>;
  flatNodes: CategoryTreeNode[];
} {
  const { scopeFilter, periodMode, selectedYear, selectedMonth, accountFilterId } = options;

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
  function assignMetadata(node: CategoryTreeNode, depth: number, ancestorNames: string[]) {
    node.depth = depth;
    node.pathNames = ancestorNames;
    if (node.id !== null) {
      flatNodes.push(node);
    }
    for (const child of node.children) {
      assignMetadata(child, depth + 1, [...ancestorNames, child.name]);
    }
  }
  assignMetadata(rootNode, 0, ["Root"]);

  // Accumulate direct transactions onto each node
  for (const tx of transactions) {
    if (accountFilterId !== "ALL" && tx.accountId !== accountFilterId) {
      continue;
    }

    const { effectiveAmount, privateAmount, businessAmount } = getEffectiveTransactionAmount(
      tx,
      scopeFilter
    );
    if (effectiveAmount <= 0) continue;

    const targetNode =
      tx.categoryId && nodeMap.has(tx.categoryId) ? nodeMap.get(tx.categoryId)! : rootNode;

    // 1. All-time direct accumulation ( transferred to recursive in post-order step )
    if (tx.type === "EXPENSE") {
      targetNode.allTimeExpense += effectiveAmount;
      targetNode.allTimeNet -= effectiveAmount;
    } else {
      targetNode.allTimeIncome += effectiveAmount;
      targetNode.allTimeNet += effectiveAmount;
    }

    // 2. Period-filtered direct accumulation
    if (matchesPeriod(tx.date, periodMode, selectedYear, selectedMonth)) {
      targetNode.directTransactionCount += 1;
      if (tx.type === "EXPENSE") {
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
    node.allTimeNet = Math.round(node.allTimeNet * 100) / 100;
    node.allTimeExpense = Math.round(node.allTimeExpense * 100) / 100;
    node.allTimeIncome = Math.round(node.allTimeIncome * 100) / 100;
  }

  rollUp(rootNode);

  return { rootNode, nodeMap, flatNodes };
}

/**
 * Returns the set of category IDs inside `selectedFolderId` (including itself and all descendants).
 * If `selectedFolderId === null` (Root), all categories match.
 */
export function getDescendantCategoryIds(
  selectedFolderId: string | null,
  nodeMap: Map<string | null, CategoryTreeNode>
): Set<string | null> {
  const result = new Set<string | null>();
  const startNode = nodeMap.get(selectedFolderId) || nodeMap.get(null);
  if (!startNode) return result;

  function collect(n: CategoryTreeNode) {
    result.add(n.id);
    for (const c of n.children) collect(c);
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

export function getYearlyMonthlySeries(
  transactions: TransactionItem[],
  year: number,
  allowedCategoryIds: Set<string | null>,
  includeAllCategories: boolean,
  scopeFilter: ScopeFilter,
  accountFilterId: string | "ALL"
): MonthlyChartPoint[] {
  const points: MonthlyChartPoint[] = MONTH_LABELS.map((label, idx) => ({
    monthIndex: idx + 1,
    label,
    expense: 0,
    income: 0,
    privateExpense: 0,
    businessExpense: 0,
    net: 0,
  }));

  for (const tx of transactions) {
    if (accountFilterId !== "ALL" && tx.accountId !== accountFilterId) continue;
    if (!includeAllCategories && !allowedCategoryIds.has(tx.categoryId)) continue;

    const txYear = Number(tx.date.slice(0, 4));
    if (txYear !== year) continue;

    const monthIdx = Number(tx.date.slice(5, 7)) - 1;
    if (monthIdx < 0 || monthIdx > 11) continue;

    const { effectiveAmount, privateAmount, businessAmount } = getEffectiveTransactionAmount(
      tx,
      scopeFilter
    );
    if (effectiveAmount <= 0) continue;

    const pt = points[monthIdx];
    if (tx.type === "EXPENSE") {
      pt.expense = Math.round((pt.expense + effectiveAmount) * 100) / 100;
      pt.privateExpense = Math.round((pt.privateExpense + privateAmount) * 100) / 100;
      pt.businessExpense = Math.round((pt.businessExpense + businessAmount) * 100) / 100;
      pt.net = Math.round((pt.net - effectiveAmount) * 100) / 100;
    } else {
      pt.income = Math.round((pt.income + effectiveAmount) * 100) / 100;
      pt.net = Math.round((pt.net + effectiveAmount) * 100) / 100;
    }
  }

  return points;
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
