"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  CreditCard,
  DatabaseBackup,
  Download,
  FolderPlus,
  Layers,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Shield,
  Split,
  Trash2,
  Upload,
  User,
  UserPlus,
  Wallet,
} from "lucide-react";
import {
  AccountItem,
  CategoryItem,
  CategoryTreeNode,
  PeriodMode,
  RecurringRuleItem,
  ScopeFilter,
  TransactionItem,
  buildCategoryTreeWithSums,
  formatCurrency,
  getDescendantCategoryIds,
  getEffectiveTransactionAmount,
  getYearlyMonthlySeries,
  getMultiYearSeries,
  localTodayYMD,
  matchesPeriod,
} from "@/lib/tree-utils";
import { CategoryTree } from "./CategoryTree";
import { SpendingCharts } from "./SpendingCharts";
import { AccountDistributionChart } from "./AccountDistributionChart";
import { LightDismissDialog } from "./LightDismissDialog";
import { AuthOnboardingView, PublicSystemState } from "./AuthOnboardingView";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  currency: string;
}

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  currency: string;
  oidcSub: string | null;
  createdAt: string;
  accountCount: number;
  transactionCount: number;
}

const FOLDER_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f43f5e",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

async function alertRequestError(res: Response) {
  const data = await res.json().catch(() => ({}));
  window.alert(data.error || `Saving failed (HTTP ${res.status}).`);
}

export function FinFlowApp() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [systemState, setSystemState] = useState<PublicSystemState>({
    needsSetup: false,
    allowRegistration: false,
    authMode: "both",
    oidcConfigured: false,
    oidcProviderName: "Single Sign-On (OIDC)",
  });

  // Main data state
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRuleItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "transactions" | "accounts" | "recurring" | "admin"
  >("dashboard");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [includeSubfoldersInTxList, setIncludeSubfoldersInTxList] = useState(true);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("ALL");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("MONTH");

  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [accountFilterId, setAccountFilterId] = useState<string | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [treeWide, setTreeWide] = useState(false);

  // Remember the tree layout per browser (a convenience only; ignore storage errors).
  useEffect(() => {
    try {
      setTreeWide(window.localStorage.getItem("finflow.treeWide") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleTreeWide = () => {
    setTreeWide((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("finflow.treeWide", next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Transaction Modal State
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editingTxRuleId, setEditingTxRuleId] = useState<string | null>(null);
  const [txType, setTxType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [txAmount, setTxAmount] = useState("");
  const [txDescription, setTxDescription] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [txDate, setTxDate] = useState(() => localTodayYMD());
  const [txAccountId, setTxAccountId] = useState("");
  const [txCategoryId, setTxCategoryId] = useState<string | null>(null);
  const [txIsSplit, setTxIsSplit] = useState(false);
  const [txBusinessPct, setTxBusinessPct] = useState(50);
  const [txBusinessAmountInput, setTxBusinessAmountInput] = useState("");

  // Folder Modal State
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
  const [folderColor, setFolderColor] = useState("#6366f1");

  // Account Modal State
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState<AccountItem["type"]>("CHECKING");
  const [accScope, setAccScope] = useState<"PRIVATE" | "BUSINESS">("PRIVATE");
  const [accInitialBalance, setAccInitialBalance] = useState("0");
  const [accColor, setAccColor] = useState("#4f46e5");

  // Recurring Modal State
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [recDescription, setRecDescription] = useState("");
  const [recType, setRecType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [recAmount, setRecAmount] = useState("");
  const [recFrequency, setRecFrequency] = useState<RecurringRuleItem["frequency"]>("MONTHLY");
  const [recStartDate, setRecStartDate] = useState(() => localTodayYMD());
  const [recEndDate, setRecEndDate] = useState("");
  const [recAccountId, setRecAccountId] = useState("");
  const [recCategoryId, setRecCategoryId] = useState<string | null>(null);
  const [recIsSplit, setRecIsSplit] = useState(false);
  const [recBusinessPct, setRecBusinessPct] = useState(50);
  const [recActive, setRecActive] = useState(true);
  const [recError, setRecError] = useState<string | null>(null);

  // Backup / Restore State
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Admin State
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminAllowReg, setAdminAllowReg] = useState(false);
  const [adminAuthMode, setAdminAuthMode] = useState<"both" | "builtin" | "oidc">("both");
  const [adminOidcIssuer, setAdminOidcIssuer] = useState("");
  const [adminOidcClientId, setAdminOidcClientId] = useState("");
  const [adminOidcClientSecret, setAdminOidcClientSecret] = useState("");
  const [adminOidcRedirectUri, setAdminOidcRedirectUri] = useState("");
  const [adminOidcProviderName, setAdminOidcProviderName] = useState("Single Sign-On (OIDC)");
  const [newUserModalOpen, setNewUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"USER" | "ADMIN">("USER");
  const [newUserSeedDemo, setNewUserSeedDemo] = useState(true);
  const [adminStatusMsg, setAdminStatusMsg] = useState<string | null>(null);

  const loadFinanceData = useCallback(async () => {
    setLoadingData(true);
    try {
      const res = await fetch("/api/finance", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setCategories(data.categories || []);
        setTransactions(data.transactions || []);
        setRecurringRules(data.recurringRules || []);
        const firstAccountId: string | undefined = data.accounts?.[0]?.id;
        if (firstAccountId) {
          setTxAccountId((prev) => prev || firstAccountId);
          setRecAccountId((prev) => prev || firstAccountId);
        }
      }
    } finally {
      setLoadingData(false);
    }
  }, []);

  const checkAuthAndLoad = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const data = await res.json();
      if (data.system) {
        setSystemState(data.system);
      }
      if (data.user) {
        setUser(data.user);
        await loadFinanceData();
      } else {
        setUser(null);
      }
    } finally {
      setAuthChecked(true);
    }
  }, [loadFinanceData]);

  useEffect(() => {
    checkAuthAndLoad();
  }, [checkAuthAndLoad]);

  const loadAdminData = useCallback(async () => {
    if (!user || user.role !== "ADMIN") return;
    const res = await fetch("/api/admin", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setAdminUsers(data.users || []);
      if (data.settings) {
        setAdminAllowReg(Boolean(data.settings.allowRegistration));
        setAdminAuthMode(data.settings.authMode || "both");
        setAdminOidcIssuer(data.settings.oidcIssuer || "");
        setAdminOidcClientId(data.settings.oidcClientId || "");
        setAdminOidcClientSecret(data.settings.oidcClientSecret || "");
        setAdminOidcRedirectUri(data.settings.oidcRedirectUri || "");
        setAdminOidcProviderName(data.settings.oidcProviderName || "Single Sign-On (OIDC)");
      }
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "admin" && user?.role === "ADMIN") {
      loadAdminData();
    }
  }, [activeTab, user, loadAdminData]);

  // Compute Category Tree with recursive sums for Root and every Folder
  const { rootNode, nodeMap, flatNodes } = useMemo(
    () =>
      buildCategoryTreeWithSums(categories, transactions, {
        scopeFilter,
        periodMode,
        selectedYear,
        selectedMonth,
        accountFilterId,
      }),
    [categories, transactions, scopeFilter, periodMode, selectedYear, selectedMonth, accountFilterId]
  );

  const activeNode: CategoryTreeNode = useMemo(
    () => nodeMap.get(selectedFolderId) || rootNode,
    [nodeMap, selectedFolderId, rootNode]
  );

  const allowedCategoryIds = useMemo(
    () => getDescendantCategoryIds(selectedFolderId, nodeMap),
    [selectedFolderId, nodeMap]
  );

  const monthlySeries = useMemo(
    () =>
      getYearlyMonthlySeries(
        transactions,
        selectedYear,
        allowedCategoryIds,
        selectedFolderId === null,
        scopeFilter,
        accountFilterId
      ),
    [transactions, selectedYear, allowedCategoryIds, selectedFolderId, scopeFilter, accountFilterId]
  );

  const yearlySeries = useMemo(
    () =>
      getMultiYearSeries(
        transactions,
        new Date().getFullYear(),
        allowedCategoryIds,
        selectedFolderId === null,
        scopeFilter,
        accountFilterId
      ),
    [transactions, allowedCategoryIds, selectedFolderId, scopeFilter, accountFilterId]
  );

  // Filtered transactions for the table
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (accountFilterId !== "ALL" && tx.accountId !== accountFilterId) return false;
      if (!matchesPeriod(tx.date, periodMode, selectedYear, selectedMonth)) return false;

      const { effectiveAmount } = getEffectiveTransactionAmount(tx, scopeFilter);
      if (effectiveAmount <= 0) return false;

      if (selectedFolderId !== null) {
        if (includeSubfoldersInTxList) {
          if (!allowedCategoryIds.has(tx.categoryId)) return false;
        } else {
          if (tx.categoryId !== selectedFolderId) return false;
        }
      }

      if (q) {
        const folderName =
          (tx.categoryId && nodeMap.get(tx.categoryId)?.pathNames.join(" ")) || "Root";
        const accNameMatch = accounts.find((a) => a.id === tx.accountId)?.name || "";
        const hay = `${tx.description} ${tx.notes} ${folderName} ${accNameMatch}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    transactions,
    accountFilterId,
    periodMode,
    selectedYear,
    selectedMonth,
    scopeFilter,
    selectedFolderId,
    includeSubfoldersInTxList,
    allowedCategoryIds,
    searchQuery,
    nodeMap,
    accounts,
  ]);

  // Compute Account Balances
  const accountBalances = useMemo(() => {
    const map = new Map<
      string,
      { balance: number; totalIn: number; totalOut: number; txCount: number }
    >();
    for (const acc of accounts) {
      map.set(acc.id, {
        balance: Number(acc.initialBalance || 0),
        totalIn: 0,
        totalOut: 0,
        txCount: 0,
      });
    }
    for (const tx of transactions) {
      const entry = map.get(tx.accountId);
      if (!entry) continue;
      entry.txCount += 1;
      if (tx.type === "INCOME") {
        entry.totalIn += tx.amount;
        entry.balance += tx.amount;
      } else {
        entry.totalOut += tx.amount;
        entry.balance -= tx.amount;
      }
    }
    return map;
  }, [accounts, transactions]);

  // Money currently held: initial balances plus every entry dated up to today, for the accounts
  // matching the account filter and (by account scope) the Private/Business switch.
  const currentBalance = useMemo(() => {
    const today = localTodayYMD();
    const included = accounts.filter(
      (acc) =>
        (accountFilterId === "ALL" || acc.id === accountFilterId) &&
        (scopeFilter === "ALL" || acc.scope === scopeFilter)
    );
    const ids = new Set(included.map((acc) => acc.id));
    let total = included.reduce((sum, acc) => sum + Number(acc.initialBalance || 0), 0);
    for (const tx of transactions) {
      if (!ids.has(tx.accountId) || tx.date > today) continue;
      total += tx.type === "INCOME" ? tx.amount : -tx.amount;
    }
    const label =
      accountFilterId !== "ALL"
        ? included[0]?.name ?? "Account"
        : scopeFilter === "ALL"
        ? "All accounts"
        : scopeFilter === "PRIVATE"
        ? "Private accounts"
        : "Business accounts";
    return { amount: Math.round(total * 100) / 100, label, accountCount: included.length };
  }, [accounts, transactions, accountFilterId, scopeFilter]);

  const currency = user?.currency || "EUR";

  const periodLabel = useMemo(() => {
    if (periodMode === "ALL") return "All Time";
    if (periodMode === "YEAR") return `Year ${selectedYear}`;
    return `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;
  }, [periodMode, selectedYear, selectedMonth]);

  // Modal Open Helpers
  const openNewTransactionModal = (presetFolderId: string | null = selectedFolderId) => {
    setEditingTxId(null);
    setEditingTxRuleId(null);
    setTxType("EXPENSE");
    setTxAmount("");
    setTxDescription("");
    setTxNotes("");
    setTxDate(localTodayYMD());
    setTxAccountId(accounts[0]?.id || "");
    setTxCategoryId(presetFolderId);
    setTxIsSplit(false);
    setTxBusinessPct(50);
    setTxBusinessAmountInput("");
    setTxModalOpen(true);
  };

  const openEditTransactionModal = (tx: TransactionItem) => {
    setEditingTxId(tx.id);
    setEditingTxRuleId(tx.recurringRuleId ?? null);
    setTxType(tx.type);
    setTxAmount(String(tx.amount));
    setTxDescription(tx.description);
    setTxNotes(tx.notes || "");
    setTxDate(tx.date);
    setTxAccountId(tx.accountId);
    setTxCategoryId(tx.categoryId);
    setTxIsSplit(tx.isSplit);
    setTxBusinessPct(tx.businessSharePct);
    setTxBusinessAmountInput(String(tx.businessAmount));
    setTxModalOpen(true);
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(txAmount);
    if (!txAccountId || !txDescription.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

    const computedBizAmt = txIsSplit
      ? txBusinessAmountInput !== ""
        ? parseFloat(txBusinessAmountInput)
        : Math.round(((numericAmount * txBusinessPct) / 100) * 100) / 100
      : undefined;

    const payload = {
      id: editingTxId,
      accountId: txAccountId,
      categoryId: txCategoryId,
      type: txType,
      amount: numericAmount,
      description: txDescription,
      notes: txNotes,
      date: txDate,
      isSplit: txIsSplit,
      businessSharePct: txBusinessPct,
      businessAmount: computedBizAmt,
    };

    const res = await fetch("/api/transactions", {
      method: editingTxId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setTxModalOpen(false);
      await loadFinanceData();
    } else {
      await alertRequestError(res);
    }
  };

  const handleDeleteTransaction = async (tx: TransactionItem) => {
    const rule = tx.recurringRuleId
      ? recurringRules.find((r) => r.id === tx.recurringRuleId)
      : undefined;
    const message = rule
      ? `Delete "${tx.description}" (${tx.date})?\n\nThis entry was booked by the recurring rule "${rule.description}". Deleting it skips this occurrence; it will not be booked again.`
      : `Delete "${tx.description}" (${tx.date})?`;
    if (!window.confirm(message)) return;
    const res = await fetch(`/api/transactions?id=${encodeURIComponent(tx.id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadFinanceData();
    }
  };

  // Folder Modal Handlers
  const openNewFolderModal = (parentId: string | null) => {
    setEditingFolderId(null);
    setFolderName("");
    setFolderParentId(parentId);
    setFolderColor(FOLDER_COLORS[categories.length % FOLDER_COLORS.length]);
    setFolderModalOpen(true);
  };

  const openEditFolderModal = (node: CategoryTreeNode) => {
    if (!node.id) return;
    setEditingFolderId(node.id);
    setFolderName(node.name);
    setFolderParentId(node.parentId);
    setFolderColor(node.color);
    setFolderModalOpen(true);
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    const res = await fetch("/api/categories", {
      method: editingFolderId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingFolderId,
        name: folderName,
        parentId: folderParentId,
        color: folderColor,
      }),
    });
    if (res.ok) {
      setFolderModalOpen(false);
      await loadFinanceData();
    } else {
      await alertRequestError(res);
    }
  };

  const handleDeleteFolder = async (node: CategoryTreeNode) => {
    if (!node.id) return;
    const parentName = node.parentId ? nodeMap.get(node.parentId)?.name || "parent folder" : "Root";
    if (
      !window.confirm(
        `Delete folder "${node.name}"?\n\nIts subfolders, transactions and recurring rules move to "${parentName}".`
      )
    )
      return;
    const res = await fetch(`/api/categories?id=${encodeURIComponent(node.id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (selectedFolderId === node.id) {
        setSelectedFolderId(node.parentId);
      }
      await loadFinanceData();
    }
  };

  // Account Modal Handlers
  const openNewAccountModal = () => {
    setEditingAccountId(null);
    setAccName("");
    setAccType("CHECKING");
    setAccScope("PRIVATE");
    setAccInitialBalance("0");
    setAccColor("#4f46e5");
    setAccountModalOpen(true);
  };

  const openEditAccountModal = (acc: AccountItem) => {
    setEditingAccountId(acc.id);
    setAccName(acc.name);
    setAccType(acc.type);
    setAccScope(acc.scope);
    setAccInitialBalance(String(acc.initialBalance));
    setAccColor(acc.color);
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;
    const res = await fetch("/api/accounts", {
      method: editingAccountId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingAccountId,
        name: accName,
        type: accType,
        scope: accScope,
        initialBalance: parseFloat(accInitialBalance || "0"),
        color: accColor,
      }),
    });
    if (res.ok) {
      setAccountModalOpen(false);
      await loadFinanceData();
    } else {
      await alertRequestError(res);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    const txCount = accountBalances.get(id)?.txCount ?? 0;
    const ruleCount = recurringRules.filter((r) => r.accountId === id).length;
    if (
      !window.confirm(
        `Delete account "${acc?.name ?? ""}"?\n\nThis permanently deletes its ${txCount} transaction(s) and ${ruleCount} recurring rule(s). This cannot be undone.`
      )
    )
      return;
    const res = await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (accountFilterId === id) setAccountFilterId("ALL");
      await loadFinanceData();
    }
  };

  // Recurring Modal Handlers
  const openNewRecurringModal = () => {
    const todayStr = localTodayYMD();
    setEditingRecurringId(null);
    setRecDescription("");
    setRecType("EXPENSE");
    setRecAmount("");
    setRecFrequency("MONTHLY");
    setRecStartDate(todayStr);
    setRecEndDate("");
    setRecAccountId(accounts[0]?.id || "");
    setRecCategoryId(selectedFolderId);
    setRecIsSplit(false);
    setRecBusinessPct(50);
    setRecActive(true);
    setRecError(null);
    setRecurringModalOpen(true);
  };

  const openEditRecurringModal = (rule: RecurringRuleItem) => {
    setEditingRecurringId(rule.id);
    setRecDescription(rule.description);
    setRecType(rule.type);
    setRecAmount(String(rule.amount));
    setRecFrequency(rule.frequency);
    setRecStartDate(rule.startDate || rule.nextRunDate);
    setRecEndDate(rule.endDate || "");
    setRecAccountId(rule.accountId);
    setRecCategoryId(rule.categoryId);
    setRecIsSplit(rule.isSplit);
    setRecBusinessPct(rule.businessSharePct);
    setRecActive(rule.active);
    setRecError(null);
    setRecurringModalOpen(true);
  };

  const applyDurationYearsPreset = (years: number | null) => {
    if (years === null) {
      setRecEndDate("");
      return;
    }
    const baseStr = recStartDate || localTodayYMD();
    const [y, m, d] = baseStr.split("-").map(Number);
    const target = new Date(Date.UTC(y + years, m - 1, d));
    const endStr = target.toISOString().slice(0, 10);
    setRecEndDate(endStr);
  };

  const handleSaveRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError(null);
    const numericAmount = parseFloat(recAmount);
    if (!recAccountId || !recDescription.trim() || isNaN(numericAmount) || numericAmount <= 0)
      return;

    if (recEndDate && recEndDate < recStartDate) {
      setRecError("End date cannot be earlier than start date.");
      return;
    }

    const res = await fetch("/api/recurring", {
      method: editingRecurringId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingRecurringId,
        accountId: recAccountId,
        categoryId: recCategoryId,
        type: recType,
        amount: numericAmount,
        description: recDescription,
        frequency: recFrequency,
        startDate: recStartDate,
        endDate: recEndDate ? recEndDate : null,
        isSplit: recIsSplit,
        businessSharePct: recBusinessPct,
        active: recActive,
      }),
    });
    if (res.ok) {
      setRecurringModalOpen(false);
      await loadFinanceData();
    } else {
      const errData = await res.json().catch(() => ({}));
      setRecError(errData.error || "Failed to save recurring rule.");
    }
  };

  const handleToggleRecurring = async (rule: RecurringRuleItem) => {
    await fetch("/api/recurring", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, active: !rule.active }),
    });
    await loadFinanceData();
  };

  const handleDeleteRecurring = async (id: string) => {
    const rule = recurringRules.find((r) => r.id === id);
    if (
      !window.confirm(
        `Delete recurring rule "${rule?.description ?? ""}"?\n\nEntries it already booked are kept as normal transactions; no new ones will be booked.`
      )
    )
      return;
    await fetch(`/api/recurring?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadFinanceData();
  };

  // Admin Handlers
  const handleSaveAdminSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminStatusMsg(null);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_settings",
        allowRegistration: adminAllowReg,
        authMode: adminAuthMode,
        oidcIssuer: adminOidcIssuer,
        oidcClientId: adminOidcClientId,
        oidcClientSecret: adminOidcClientSecret,
        oidcRedirectUri: adminOidcRedirectUri,
        oidcProviderName: adminOidcProviderName,
      }),
    });
    if (res.ok) {
      setAdminStatusMsg("Authentication & registration settings saved.");
      await loadAdminData();
    }
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_user",
        name: newUserName,
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
        seedDemoData: newUserSeedDemo,
      }),
    });
    if (res.ok) {
      setNewUserModalOpen(false);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      await loadAdminData();
    }
  };

  const handleDeleteUser = async (id: string) => {
    const target = adminUsers.find((u) => u.id === id);
    if (
      !window.confirm(
        `Delete user "${target?.email ?? ""}" and all of their accounts, transactions and rules? This cannot be undone.`
      )
    )
      return;
    const res = await fetch(`/api/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      await loadAdminData();
    }
  };

  // Backup / Restore Handlers
  const openBackupModal = () => {
    setBackupMsg(null);
    setBackupModalOpen(true);
  };

  const handleExportBackup = async () => {
    setBackupMsg(null);
    setBackupBusy(true);
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBackupMsg({ kind: "error", text: data.error || `Export failed (HTTP ${res.status}).` });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `finflow-backup-${localTodayYMD()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBackupMsg({ kind: "ok", text: `Backup downloaded as ${filename}.` });
    } catch {
      setBackupMsg({ kind: "error", text: "Export failed. Please check your connection." });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    setBackupMsg(null);
    let text: string;
    let parsed: {
      format?: string;
      exportedAt?: string;
      accounts?: unknown[];
      categories?: unknown[];
      transactions?: unknown[];
      recurringRules?: unknown[];
    };
    try {
      text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setBackupMsg({ kind: "error", text: "This file is not valid JSON." });
      return;
    }
    if (!parsed || parsed.format !== "finflow-backup") {
      setBackupMsg({ kind: "error", text: "This file is not a FinFlow backup." });
      return;
    }

    const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    const exportedAt = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : "unknown date";
    const confirmed = window.confirm(
      `Restore backup from ${exportedAt}?\n\n` +
        `Backup contains: ${count(parsed.accounts)} accounts, ${count(parsed.categories)} folders, ` +
        `${count(parsed.transactions)} transactions, ${count(parsed.recurringRules)} recurring rules.\n\n` +
        `This REPLACES all your current data (${accounts.length} accounts, ${transactions.length} transactions, ` +
        `${recurringRules.length} recurring rules). This cannot be undone. Export a backup of your current data first if you might need it.`
    );
    if (!confirmed) return;

    setBackupBusy(true);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackupMsg({ kind: "error", text: data.error || `Import failed (HTTP ${res.status}).` });
        return;
      }
      // All IDs changed: reset selections that point at old records, then reload everything.
      setSelectedFolderId(null);
      setAccountFilterId("ALL");
      setTxAccountId("");
      setRecAccountId("");
      await checkAuthAndLoad();
      const i = data.imported || {};
      setBackupMsg({
        kind: "ok",
        text: `Restored ${i.accounts ?? 0} accounts, ${i.categories ?? 0} folders, ${i.transactions ?? 0} transactions and ${i.recurringRules ?? 0} recurring rules.`,
      });
    } catch {
      setBackupMsg({ kind: "error", text: "Import failed. Your existing data was not changed." });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    await checkAuthAndLoad();
  };

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
          <span className="text-sm font-medium">Loading FinFlow...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthOnboardingView system={systemState} onAuthenticated={checkAuthAndLoad} />;
  }

  const selectedTxAccount = accounts.find((a) => a.id === txAccountId);
  const numericTxAmt = parseFloat(txAmount || "0") || 0;
  const previewBizAmt = txIsSplit
    ? txBusinessAmountInput !== ""
      ? Math.min(numericTxAmt, Math.max(0, parseFloat(txBusinessAmountInput) || 0))
      : Math.round(((numericTxAmt * txBusinessPct) / 100) * 100) / 100
    : selectedTxAccount?.scope === "BUSINESS"
    ? numericTxAmt
    : 0;
  const previewPrivAmt = Math.max(0, Math.round((numericTxAmt - previewBizAmt) * 100) / 100);

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row bg-slate-950 text-slate-100 pb-20 lg:pb-0">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900/95 border-r border-slate-800/80 z-30">
        <div className="p-5 flex items-center gap-3 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-base text-white tracking-tight block">FinFlow</span>
            <span className="text-[11px] text-slate-400 block">Private & Business Finance</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "dashboard"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
            }`}
          >
            <Layers className="w-4 h-4" />
            Tree & Charts
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transactions")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "transactions"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Transactions
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              {filteredTransactions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("accounts")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "accounts"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
            }`}
          >
            <Wallet className="w-4 h-4" />
            Bank Accounts
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              {accounts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("recurring")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "recurring"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
            }`}
          >
            <Repeat className="w-4 h-4" />
            Recurring Rules
          </button>

          {user.role === "ADMIN" && (
            <button
              type="button"
              onClick={() => setActiveTab("admin")}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                activeTab === "admin"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <Shield className="w-4 h-4 text-amber-400" />
              Admin & Auth
            </button>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {user.role}
            </span>
          </div>
          <button
            type="button"
            onClick={openBackupModal}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <DatabaseBackup className="w-3.5 h-3.5" />
            Backup & Restore
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Sticky Top Header with Global Filters (Scope: All/Private/Business, Period: Month/Year/All, Account) */}
        <header className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Mobile Brand + Title */}
            <div className="flex items-center gap-2.5">
              <div className="lg:hidden w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h1 className="fluid-heading font-bold text-white">
                  {activeTab === "dashboard" && "Category Tree & Analytics"}
                  {activeTab === "transactions" && "Transactions Explorer"}
                  {activeTab === "accounts" && "Private & Business Accounts"}
                  {activeTab === "recurring" && "Recurring Transactions"}
                  {activeTab === "admin" && "System Administration & Auth"}
                </h1>
              </div>
            </div>

            {/* Global Controls: Scope Filter + Time Period + Add Transaction */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Private / Business Scope Filter */}
              <div
                role="group"
                aria-label="Filter by Private or Business scope"
                className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => setScopeFilter("ALL")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    scopeFilter === "ALL"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter("PRIVATE")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                    scopeFilter === "PRIVATE"
                      ? "bg-violet-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <User className="w-3 h-3" />
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter("BUSINESS")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                    scopeFilter === "BUSINESS"
                      ? "bg-sky-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Briefcase className="w-3 h-3" />
                  Business
                </button>
              </div>

              {/* Period Mode (Month / Year / All Time) */}
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-900 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPeriodMode("MONTH")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    periodMode === "MONTH"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Month
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode("YEAR")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    periodMode === "YEAR"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Year
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode("ALL")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    periodMode === "ALL"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  All Time
                </button>
              </div>

              {/* Month & Year Selectors */}
              {periodMode === "MONTH" && (
                <select
                  aria-label="Select Month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {MONTH_NAMES.map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              )}

              {periodMode !== "ALL" && (
                <select
                  aria-label="Select Year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {Array.from(
                    new Set([
                      ...transactions
                        .map((t) => Number(t.date.slice(0, 4)))
                        .filter((y) => !isNaN(y) && y > 1970),
                      now.getFullYear() - 2,
                      now.getFullYear() - 1,
                      now.getFullYear(),
                      now.getFullYear() + 1,
                      selectedYear,
                    ])
                  )
                    .sort((a, b) => a - b)
                    .map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                </select>
              )}

              {/* Account Filter */}
              <select
                aria-label="Filter by Bank Account"
                value={accountFilterId}
                onChange={(e) => setAccountFilterId(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 max-w-[170px] truncate"
              >
                <option value="ALL">All Accounts</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.scope === "BUSINESS" ? "Biz" : "Priv"})
                  </option>
                ))}
              </select>

              {/* Primary CTA: Add Transaction */}
              <button
                type="button"
                onClick={() => openNewTransactionModal(selectedFolderId)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Add Transaction</span>
              </button>

              <button
                type="button"
                onClick={openBackupModal}
                title="Backup & Restore"
                aria-label="Backup & Restore"
                className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
              >
                <DatabaseBackup className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleLogout}
                title="Sign Out"
                className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-[1600px] w-full mx-auto">
          {/* KPI Summary Row */}
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* KPI 1: Active Folder / Root Net Sum */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="truncate font-medium">
                  {activeNode.id === null ? "Root Net Sum" : `${activeNode.name} Sum`} ({periodLabel})
                </span>
                <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
              </div>
              <div
                className={`text-2xl font-bold mt-1.5 tabular-nums ${
                  activeNode.totalNet >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrency(activeNode.totalNet, currency, true)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>All-Time Folder Sum:</span>
                <span className="font-semibold text-slate-200 tabular-nums">
                  {formatCurrency(activeNode.allTimeNet, currency, true)}
                </span>
              </div>
            </div>

            {/* KPI 2: Expenses in Selected Folder & Period (with Private vs Business breakdown) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Expenses ({periodLabel})</span>
                <ArrowDownRight className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-rose-400 mt-1.5 tabular-nums">
                -{formatCurrency(activeNode.totalExpense, currency)}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span className="text-violet-300">
                  Priv: {formatCurrency(activeNode.privateExpense, currency)}
                </span>
                <span className="text-sky-300">
                  Biz: {formatCurrency(activeNode.businessExpense, currency)}
                </span>
              </div>
            </div>

            {/* KPI 3: Income in Selected Folder & Period */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Income ({periodLabel})</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400 mt-1.5 tabular-nums">
                +{formatCurrency(activeNode.totalIncome, currency)}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span className="text-violet-300">
                  Priv: {formatCurrency(activeNode.privateIncome, currency)}
                </span>
                <span className="text-sky-300">
                  Biz: {formatCurrency(activeNode.businessIncome, currency)}
                </span>
              </div>
            </div>

            {/* KPI 4: Root Current Sum */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-md">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Root Total ({periodLabel})</span>
                <Wallet className="w-4 h-4 text-sky-400" />
              </div>
              <div
                className={`text-2xl font-bold mt-1.5 tabular-nums ${
                  rootNode.totalNet >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrency(rootNode.totalNet, currency, true)}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>Out: -{formatCurrency(rootNode.totalExpense, currency)}</span>
                <span>In: +{formatCurrency(rootNode.totalIncome, currency)}</span>
              </div>
              <div
                className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-400"
                title={`Initial balances plus all entries up to today (${currentBalance.label}, ${currentBalance.accountCount} account${currentBalance.accountCount === 1 ? "" : "s"})`}
              >
                <span className="min-w-0 leading-tight">
                  <span className="block">Balance today</span>
                  <span className="block truncate text-[10px] text-slate-500">{currentBalance.label}</span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums shrink-0 ${
                    currentBalance.amount >= 0 ? "text-slate-100" : "text-rose-400"
                  }`}
                >
                  {formatCurrency(currentBalance.amount, currency)}
                </span>
              </div>
            </div>
          </section>

          {/* TAB 1: DASHBOARD (Category Tree + Charts + Folder Transactions) */}
          {activeTab === "dashboard" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left Column (or full width in wide view / below xl): Hierarchical Category Tree */}
              <div className={treeWide ? "xl:col-span-12" : "xl:col-span-6 2xl:col-span-5"}>
                <CategoryTree
                  rootNode={rootNode}
                  selectedFolderId={selectedFolderId}
                  onSelectFolder={(id) => setSelectedFolderId(id)}
                  onAddSubfolder={(parentId) => openNewFolderModal(parentId)}
                  onEditFolder={(node) => openEditFolderModal(node)}
                  onDeleteFolder={(node) => handleDeleteFolder(node)}
                  onAddTransactionInFolder={(folderId) => openNewTransactionModal(folderId)}
                  currency={currency}
                  wide={treeWide}
                  onToggleWide={toggleTreeWide}
                />
              </div>

              {/* Right Column (below the tree in wide view): Charts + Transactions in Active Folder */}
              <div className={`space-y-6 ${treeWide ? "xl:col-span-12" : "xl:col-span-6 2xl:col-span-7"}`}>
                <SpendingCharts
                  activeNode={activeNode}
                  onSelectFolder={(id) => setSelectedFolderId(id)}
                  monthlySeries={monthlySeries}
                  selectedYear={selectedYear}
                  selectedMonth={selectedMonth}
                  periodLabel={periodLabel}
                  currency={currency}
                  onSelectMonth={(month) => {
                    setPeriodMode("MONTH");
                    setSelectedMonth(month);
                  }}
                  yearlySeries={yearlySeries}
                  onSelectYear={(year) => {
                    setPeriodMode("YEAR");
                    setSelectedYear(year);
                  }}
                  wide={treeWide}
                />

                {/* Transactions inside the selected folder */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Transactions in{" "}
                        <span className="text-indigo-400">
                          {activeNode.pathNames.join(" / ")}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Showing {filteredTransactions.length} transaction(s) for {periodLabel}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {selectedFolderId !== null && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
                          <input
                            type="checkbox"
                            checked={includeSubfoldersInTxList}
                            onChange={(e) => setIncludeSubfoldersInTxList(e.target.checked)}
                            className="accent-indigo-500 rounded"
                          />
                          Include Subfolders
                        </label>
                      )}
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          placeholder="Search..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-8 pr-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {renderResponsiveTransactionsTable(
                    filteredTransactions,
                    accounts,
                    nodeMap,
                    scopeFilter,
                    currency,
                    openEditTransactionModal,
                    handleDeleteTransaction
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FULL TRANSACTIONS EXPLORER */}
          {activeTab === "transactions" && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">All Filtered Transactions</h2>
                  <p className="text-xs text-slate-400">
                    Folder:{" "}
                    <span className="text-indigo-300 font-medium">
                      {activeNode.pathNames.join(" / ")}
                    </span>{" "}
                    • Period: {periodLabel} • Scope: {scopeFilter}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedFolderId ?? "ROOT"}
                    onChange={(e) =>
                      setSelectedFolderId(e.target.value === "ROOT" ? null : e.target.value)
                    }
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200"
                  >
                    <option value="ROOT">Root (All Folders)</option>
                    {flatNodes.map((n) => (
                      <option key={n.id!} value={n.id!}>
                        {"—".repeat(Math.max(0, n.depth - 1))} {n.name} (
                        {formatCurrency(n.totalNet, currency, true)})
                      </option>
                    ))}
                  </select>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Filter description or notes..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {renderResponsiveTransactionsTable(
                filteredTransactions,
                accounts,
                nodeMap,
                scopeFilter,
                currency,
                openEditTransactionModal,
                handleDeleteTransaction
              )}
            </div>
          )}

          {/* TAB 3: PRIVATE & BUSINESS BANK ACCOUNTS */}
          {activeTab === "accounts" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Bank & Payment Accounts (Private & Business)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Each transaction is linked to an account. Transactions can inherit their
                    account&apos;s scope or be split between Private & Business.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewAccountModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                >
                  <Plus className="w-4 h-4" />
                  New Account
                </button>
              </div>

              {accounts.length > 0 && (
                <AccountDistributionChart
                  accounts={accounts}
                  balances={accountBalances}
                  currency={currency}
                  onSelectAccount={(id) => {
                    setAccountFilterId(id);
                    setActiveTab("transactions");
                  }}
                />
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {accounts.map((acc) => {
                  const stats = accountBalances.get(acc.id) || {
                    balance: acc.initialBalance,
                    totalIn: 0,
                    totalOut: 0,
                    txCount: 0,
                  };
                  return (
                    <div
                      key={acc.id}
                      className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-md flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${acc.color}22`, color: acc.color }}
                            >
                              {acc.scope === "BUSINESS" ? (
                                <Briefcase className="w-4 h-4" />
                              ) : (
                                <Wallet className="w-4 h-4" />
                              )}
                            </span>
                            <div>
                              <h3 className="text-sm font-semibold text-white">{acc.name}</h3>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    acc.scope === "BUSINESS"
                                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                      : "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                                  }`}
                                >
                                  {acc.scope}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {acc.type.replace("_", " ")}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditAccountModal(acc)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                              title="Edit Account"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(acc.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                              title="Delete Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-baseline justify-between">
                          <span className="text-xs text-slate-400">Current Balance</span>
                          <span
                            className={`text-xl font-bold tabular-nums ${
                              stats.balance >= 0 ? "text-white" : "text-rose-400"
                            }`}
                          >
                            {formatCurrency(stats.balance, currency)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                          <span>Initial: {formatCurrency(acc.initialBalance, currency)}</span>
                          <span>{stats.txCount} transactions</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setAccountFilterId(acc.id);
                          setActiveTab("transactions");
                        }}
                        className="mt-4 w-full py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-medium text-indigo-300 transition-colors"
                      >
                        View Account Transactions →
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: RECURRING TRANSACTIONS */}
          {activeTab === "recurring" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Automated Recurring Transactions
                  </h2>
                  <p className="text-xs text-slate-400">
                    Subscriptions, rent, and salary rules with configurable start and end dates
                    (e.g. 5-year monthly contracts).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewRecurringModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                >
                  <Plus className="w-4 h-4" />
                  New Recurring Rule
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recurringRules.length === 0 ? (
                  <div className="col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-400">
                    No recurring rules configured yet.
                  </div>
                ) : (
                  recurringRules.map((rule) => {
                    const acc = accounts.find((a) => a.id === rule.accountId);
                    const cat = rule.categoryId ? nodeMap.get(rule.categoryId) : rootNode;
                    return (
                      <div
                        key={rule.id}
                        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-white truncate">
                              {rule.description}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                              {rule.frequency}
                            </span>
                            {rule.isSplit && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                Split {rule.businessSharePct}% Biz
                              </span>
                            )}
                            {rule.endDate && rule.endDate < localTodayYMD() ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                                Ended
                              </span>
                            ) : (
                              !rule.active && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                                  Paused{rule.pausedSince ? ` since ${rule.pausedSince}` : ""}
                                </span>
                              )
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>Folder: {cat?.pathNames.join(" / ") || "Root"}</span>
                            <span>Account: {acc?.name || "Unknown"}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span>
                              Start:{" "}
                              <strong className="text-slate-200 font-medium">
                                {rule.startDate || rule.nextRunDate}
                              </strong>
                            </span>
                            <span>
                              End:{" "}
                              <strong className="text-slate-200 font-medium">
                                {rule.endDate ? rule.endDate : "No End Date (Ongoing)"}
                              </strong>
                            </span>
                            <span>
                              Next Run:{" "}
                              <strong className="text-indigo-300 font-medium">
                                {!rule.active ||
                                (rule.endDate && rule.nextRunDate > rule.endDate)
                                  ? "—"
                                  : rule.nextRunDate}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-sm font-bold tabular-nums mr-1 ${
                              rule.type === "INCOME" ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {rule.type === "INCOME" ? "+" : "-"}
                            {formatCurrency(rule.amount, currency)}
                          </span>
                          <input
                            type="checkbox"
                            checked={rule.active}
                            onChange={() => handleToggleRecurring(rule)}
                            title={rule.active ? "Pause rule" : "Resume rule"}
                            className="w-4 h-4 accent-indigo-500 cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() => openEditRecurringModal(rule)}
                            title="Edit recurring rule"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecurring(rule.id)}
                            title="Delete recurring rule"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 5: ADMIN PANEL (User Management, Self-Registration & OIDC Config) */}
          {activeTab === "admin" && user.role === "ADMIN" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Left: System Auth & Registration Settings */}
              <div className="xl:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                  <Settings className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white">
                    Authentication & Registration Settings
                  </h2>
                </div>

                {adminStatusMsg && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-300">
                    {adminStatusMsg}
                  </div>
                )}

                <form onSubmit={handleSaveAdminSettings} className="mt-4 space-y-4">
                  <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <div>
                      <span className="text-sm font-medium text-white block">
                        Allow Public Self-Registration
                      </span>
                      <span className="text-xs text-slate-400">
                        Let visitors create their own isolated account on the login page.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={adminAllowReg}
                      onChange={(e) => setAdminAllowReg(e.target.checked)}
                      className="w-4 h-4 accent-indigo-500"
                    />
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Login Authentication Mode
                    </label>
                    <select
                      value={adminAuthMode}
                      onChange={(e) =>
                        setAdminAuthMode(e.target.value as "both" | "builtin" | "oidc")
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
                    >
                      <option value="both">Built-in Email/Password + OIDC</option>
                      <option value="builtin">Built-in Email/Password Only</option>
                      <option value="oidc">OIDC (OpenID Connect) Only</option>
                    </select>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      OpenID Connect (OIDC) Provider Settings
                    </h3>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Provider Name</label>
                      <input
                        type="text"
                        value={adminOidcProviderName}
                        onChange={(e) => setAdminOidcProviderName(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        OIDC Issuer URL (Discovery Base URL)
                      </label>
                      <input
                        type="text"
                        placeholder="https://auth.example.com/application/o/finflow"
                        value={adminOidcIssuer}
                        onChange={(e) => setAdminOidcIssuer(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Client ID</label>
                        <input
                          type="text"
                          value={adminOidcClientId}
                          onChange={(e) => setAdminOidcClientId(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Client Secret</label>
                        <input
                          type="password"
                          value={adminOidcClientSecret}
                          onChange={(e) => setAdminOidcClientSecret(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Redirect URI</label>
                      <input
                        type="text"
                        value={adminOidcRedirectUri}
                        onChange={(e) => setAdminOidcRedirectUri(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
                  >
                    Save System Settings
                  </button>
                </form>
              </div>

              {/* Right: User Management */}
              <div className="xl:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Registered Users</h2>
                    <p className="text-xs text-slate-400">
                      Each user has an isolated Category Tree, Accounts, and Transactions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewUserModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Create User
                  </button>
                </div>

                <div className="mt-4 space-y-2.5">
                  {adminUsers.map((u) => (
                    <div
                      key={u.id}
                      className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{u.name}</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              u.role === "ADMIN"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {u.role}
                          </span>
                          {u.oidcSub && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                              OIDC Linked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {u.email} • {u.accountCount} accounts • {u.transactionCount} transactions
                        </p>
                      </div>

                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around py-2 px-2">
        <button
          type="button"
          onClick={() => setActiveTab("dashboard")}
          className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-medium ${
            activeTab === "dashboard" ? "text-indigo-400" : "text-slate-400"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Tree & Charts</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("transactions")}
          className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-medium ${
            activeTab === "transactions" ? "text-indigo-400" : "text-slate-400"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Transactions</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-medium ${
            activeTab === "accounts" ? "text-indigo-400" : "text-slate-400"
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Accounts</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("recurring")}
          className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-medium ${
            activeTab === "recurring" ? "text-indigo-400" : "text-slate-400"
          }`}
        >
          <Repeat className="w-4 h-4" />
          <span>Recurring</span>
        </button>
        {user.role === "ADMIN" && (
          <button
            type="button"
            onClick={() => setActiveTab("admin")}
            className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-[11px] font-medium ${
              activeTab === "admin" ? "text-indigo-400" : "text-slate-400"
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Admin</span>
          </button>
        )}
      </nav>

      {/* MODAL 1: ADD / EDIT TRANSACTION */}
      <LightDismissDialog
        open={txModalOpen}
        onClose={() => setTxModalOpen(false)}
        title={editingTxId ? "Edit Transaction" : "Add Expense or Income"}
        subtitle="Assign to any Category Tree folder (or Root) and Private/Business account."
      >
        <form onSubmit={handleSaveTransaction} className="space-y-4">
          {editingTxId && editingTxRuleId && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-[11px] text-indigo-200 leading-relaxed">
              Booked by the recurring rule &quot;
              {recurringRules.find((r) => r.id === editingTxRuleId)?.description ?? "deleted rule"}
              &quot;. Your changes to this entry are kept even if the rule is edited later.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setTxType("EXPENSE")}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                txType === "EXPENSE"
                  ? "bg-rose-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Expense (-)
            </button>
            <button
              type="button"
              onClick={() => setTxType("INCOME")}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                txType === "INCOME"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Income (+)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Amount ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Date</label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="date"
                  required
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
            <input
              type="text"
              required
              placeholder="e.g. Fiber Internet Bill, Client Lunch, Monthly Groceries"
              value={txDescription}
              onChange={(e) => setTxDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Bank / Payment Account
              </label>
              <select
                value={txAccountId}
                onChange={(e) => setTxAccountId(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.scope})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Category Folder
              </label>
              <select
                value={txCategoryId ?? "ROOT"}
                onChange={(e) =>
                  setTxCategoryId(e.target.value === "ROOT" ? null : e.target.value)
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="ROOT">Root (Top Level)</option>
                {flatNodes.map((n) => (
                  <option key={n.id!} value={n.id!}>
                    {"—".repeat(Math.max(0, n.depth - 1))} {n.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Private vs Business Split Configuration */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <div className="flex items-center gap-2">
                <Split className="w-4 h-4 text-sky-400" />
                <div>
                  <span className="text-xs font-semibold text-white block">
                    Split between Private & Business
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {!txIsSplit
                      ? `Defaulting to 100% ${
                          selectedTxAccount?.scope || "PRIVATE"
                        } (from selected account)`
                      : `Splitting ${100 - txBusinessPct}% Private / ${txBusinessPct}% Business`}
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={txIsSplit}
                onChange={(e) => {
                  setTxIsSplit(e.target.checked);
                  setTxBusinessAmountInput("");
                }}
                className="w-4 h-4 accent-indigo-500"
              />
            </label>

            {txIsSplit && (
              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-violet-300 font-medium">
                    Private: {formatCurrency(previewPrivAmt, currency)} (
                    {Math.round(100 - txBusinessPct)}%)
                  </span>
                  <span className="text-sky-300 font-medium">
                    Business: {formatCurrency(previewBizAmt, currency)} (
                    {Math.round(txBusinessPct)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={txBusinessPct}
                  onChange={(e) => {
                    const pct = Number(e.target.value);
                    setTxBusinessPct(pct);
                    setTxBusinessAmountInput("");
                  }}
                  className="w-full accent-sky-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Exact Business Amount:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={String(previewBizAmt)}
                    value={txBusinessAmountInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTxBusinessAmountInput(val);
                      const num = parseFloat(val);
                      if (!isNaN(num) && numericTxAmt > 0) {
                        setTxBusinessPct(
                          Math.min(100, Math.max(0, Math.round((num / numericTxAmt) * 1000) / 10))
                        );
                      }
                    }}
                    className="w-28 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="Invoice number, tax deduction note, etc."
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTxModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              {editingTxId ? "Save Changes" : "Create Transaction"}
            </button>
          </div>
        </form>
      </LightDismissDialog>

      {/* MODAL 2: ADD / EDIT CATEGORY FOLDER */}
      <LightDismissDialog
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        title={editingFolderId ? "Edit Category Folder" : "Create Category Folder"}
        subtitle="Folders can contain both subfolders and direct expenses/income."
      >
        <form onSubmit={handleSaveFolder} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Folder Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Utilities, Cloud & SaaS, Groceries"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Parent Folder</label>
            <select
              value={folderParentId ?? "ROOT"}
              onChange={(e) =>
                setFolderParentId(e.target.value === "ROOT" ? null : e.target.value)
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            >
              <option value="ROOT">Root (Top Level)</option>
              {flatNodes
                .filter((n) => n.id !== editingFolderId)
                .map((n) => (
                  <option key={n.id!} value={n.id!}>
                    {"—".repeat(Math.max(0, n.depth - 1))} {n.name}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Folder Color</label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFolderColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    folderColor === c ? "scale-110 ring-2 ring-white" : "opacity-75 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFolderModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              {editingFolderId ? "Update Folder" : "Create Folder"}
            </button>
          </div>
        </form>
      </LightDismissDialog>

      {/* MODAL 3: ADD / EDIT BANK ACCOUNT */}
      <LightDismissDialog
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        title={editingAccountId ? "Edit Account" : "Create Bank / Payment Account"}
        subtitle="Specify whether this account is primarily Private or Business."
      >
        <form onSubmit={handleSaveAccount} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Account Name</label>
            <input
              type="text"
              required
              placeholder="e.g. N26 Business Card, Personal Checking"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Default Account Scope
              </label>
              <select
                value={accScope}
                onChange={(e) => setAccScope(e.target.value as "PRIVATE" | "BUSINESS")}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="PRIVATE">Private Account</option>
                <option value="BUSINESS">Business Account</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Account Type</label>
              <select
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountItem["type"])}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="CHECKING">Checking Account</option>
                <option value="CREDIT_CARD">Credit Card</option>
                <option value="SAVINGS">Savings</option>
                <option value="CASH">Cash Wallet</option>
                <option value="INVESTMENT">Investment</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Starting Balance ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              value={accInitialBalance}
              onChange={(e) => setAccInitialBalance(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAccountModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              {editingAccountId ? "Update Account" : "Create Account"}
            </button>
          </div>
        </form>
      </LightDismissDialog>

      {/* MODAL 4: NEW / EDIT RECURRING RULE */}
      <LightDismissDialog
        open={recurringModalOpen}
        onClose={() => setRecurringModalOpen(false)}
        title={
          editingRecurringId
            ? "Edit Recurring Transaction Rule"
            : "New Recurring Transaction Rule"
        }
        subtitle="Configure schedule, start & end dates (e.g. a 5-year monthly payment), and account split."
      >
        <form onSubmit={handleSaveRecurring} className="space-y-4">
          {recError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
              {recError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setRecType("EXPENSE")}
              className={`py-1.5 rounded-lg text-xs font-semibold ${
                recType === "EXPENSE" ? "bg-rose-600 text-white" : "text-slate-400"
              }`}
            >
              Recurring Expense
            </button>
            <button
              type="button"
              onClick={() => setRecType("INCOME")}
              className={`py-1.5 rounded-lg text-xs font-semibold ${
                recType === "INCOME" ? "bg-emerald-600 text-white" : "text-slate-400"
              }`}
            >
              Recurring Income
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
            <input
              type="text"
              required
              placeholder="e.g. Office Rent, Car Lease (5 Years), Monthly Salary"
              value={recDescription}
              onChange={(e) => setRecDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Amount ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={recAmount}
                onChange={(e) => setRecAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Frequency</label>
              <select
                value={recFrequency}
                onChange={(e) =>
                  setRecFrequency(e.target.value as RecurringRuleItem["frequency"])
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="MONTHLY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="YEARLY">Yearly</option>
                <option value="DAILY">Daily</option>
              </select>
            </div>
          </div>

          {/* Start Date & End Date (with quick duration presets) */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Start Date</label>
                <input
                  type="date"
                  required
                  value={recStartDate}
                  onChange={(e) => setRecStartDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  End Date <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="date"
                  min={recStartDate}
                  value={recEndDate}
                  onChange={(e) => setRecEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-400">Quick Duration from Start Date:</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyDurationYearsPreset(1)}
                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white transition-colors"
                >
                  +1 Year
                </button>
                <button
                  type="button"
                  onClick={() => applyDurationYearsPreset(3)}
                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white transition-colors"
                >
                  +3 Years
                </button>
                <button
                  type="button"
                  onClick={() => applyDurationYearsPreset(5)}
                  className="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-[11px] text-indigo-300 font-medium transition-colors"
                >
                  +5 Years
                </button>
                <button
                  type="button"
                  onClick={() => applyDurationYearsPreset(null)}
                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-white transition-colors"
                >
                  No End Date
                </button>
              </div>
            </div>

            {editingRecurringId && (
              <label className="pt-3 border-t border-slate-800 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recActive}
                  onChange={(e) => setRecActive(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500"
                />
                <span className="text-xs text-slate-200">
                  Rule is active{" "}
                  <span className="text-slate-500">
                    (uncheck to pause; periods missed while paused are skipped)
                  </span>
                </span>
              </label>
            )}
          </div>

          {editingRecurringId && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-[11px] text-indigo-200 leading-relaxed">
              Saving rewrites all entries this rule has booked so far with the new settings.
              Entries you edited by hand are kept, and deleted entries stay deleted. For a price
              change that should only apply from now on, set an end date on this rule and create
              a new one.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Account</label>
              <select
                value={recAccountId}
                onChange={(e) => setRecAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.scope})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Category Folder
              </label>
              <select
                value={recCategoryId ?? "ROOT"}
                onChange={(e) =>
                  setRecCategoryId(e.target.value === "ROOT" ? null : e.target.value)
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="ROOT">Root</option>
                {flatNodes.map((n) => (
                  <option key={n.id!} value={n.id!}>
                    {"—".repeat(Math.max(0, n.depth - 1))} {n.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
            <span className="text-xs text-slate-200">Split Private / Business Share</span>
            <input
              type="checkbox"
              checked={recIsSplit}
              onChange={(e) => setRecIsSplit(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
          </label>

          {recIsSplit && (
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Business Share: {recBusinessPct}%
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={recBusinessPct}
                onChange={(e) => setRecBusinessPct(Number(e.target.value))}
                className="w-full accent-sky-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRecurringModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              {editingRecurringId ? "Save Changes" : "Save Recurring Rule"}
            </button>
          </div>
        </form>
      </LightDismissDialog>

      {/* MODAL: BACKUP & RESTORE */}
      <LightDismissDialog
        open={backupModalOpen}
        onClose={() => !backupBusy && setBackupModalOpen(false)}
        title="Backup & Restore"
        subtitle="Export all your accounts, folders, transactions and recurring rules as a JSON file, or restore them from one."
      >
        <div className="space-y-4">
          {backupMsg && (
            <div
              role="status"
              className={`p-3 rounded-xl text-xs border ${
                backupMsg.kind === "ok"
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                  : "bg-rose-500/15 border-rose-500/40 text-rose-200"
              }`}
            >
              {backupMsg.text}
            </div>
          )}

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <h3 className="text-sm font-semibold text-white">Export</h3>
            <p className="text-xs text-slate-400">
              Downloads a complete backup of your data. Keep it somewhere safe; you can restore it
              here at any time, also on another FinFlow instance or account.
            </p>
            <button
              type="button"
              onClick={handleExportBackup}
              disabled={backupBusy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white"
            >
              <Download className="w-4 h-4" />
              Download Backup (JSON)
            </button>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-rose-500/30 space-y-2">
            <h3 className="text-sm font-semibold text-white">Restore</h3>
            <p className="text-xs text-slate-400">
              Replaces <strong className="text-rose-300">all</strong> of your current data with the
              contents of a backup file. If the file is invalid, nothing is changed.
            </p>
            <label
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 ${
                backupBusy ? "opacity-50 pointer-events-none" : "cursor-pointer"
              }`}
            >
              <Upload className="w-4 h-4" />
              Choose Backup File…
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={backupBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleImportBackup(file);
                }}
              />
            </label>
          </div>

          {backupBusy && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Working…
            </div>
          )}
        </div>
      </LightDismissDialog>

      {/* MODAL 5: ADMIN CREATE USER */}
      <LightDismissDialog
        open={newUserModalOpen}
        onClose={() => setNewUserModalOpen(false)}
        title="Create New User"
        subtitle="Provision a new user account with its own isolated financial workspace."
      >
        <form onSubmit={handleCreateAdminUser} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Role</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as "USER" | "ADMIN")}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
              >
                <option value="USER">Standard User</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
            <span className="text-xs text-slate-200">
              Seed starter Category Tree & sample transactions
            </span>
            <input
              type="checkbox"
              checked={newUserSeedDemo}
              onChange={(e) => setNewUserSeedDemo(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewUserModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              Create User
            </button>
          </div>
        </form>
      </LightDismissDialog>
    </div>
  );
}

function renderResponsiveTransactionsTable(
  transactions: TransactionItem[],
  accounts: AccountItem[],
  nodeMap: Map<string | null, CategoryTreeNode>,
  scopeFilter: ScopeFilter,
  currency: string,
  onEdit: (tx: TransactionItem) => void,
  onDelete: (tx: TransactionItem) => void
) {
  if (transactions.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-xl">
        No transactions match the current folder, period, and scope filter.
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby="transactions-table-caption"
      className="table-wrapper border border-slate-800/80"
    >
      <table className="responsive-finance-table text-left text-xs">
        <caption id="transactions-table-caption" className="sr-only">
          Filtered financial transactions list
        </caption>
        <thead>
          <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
            <th className="py-3 px-4 font-semibold">Description</th>
            <th className="py-3 px-3 font-semibold">Category Folder</th>
            <th className="py-3 px-3 font-semibold">Account</th>
            <th className="py-3 px-3 font-semibold">Scope / Split</th>
            <th className="py-3 px-3 font-semibold">Date</th>
            <th className="py-3 px-3 font-semibold text-right">Amount</th>
            <th className="py-3 px-4 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {transactions.map((tx) => {
            const folder = (tx.categoryId && nodeMap.get(tx.categoryId)) || nodeMap.get(null);
            const acc = accounts.find((a) => a.id === tx.accountId);
            const { effectiveAmount } = getEffectiveTransactionAmount(tx, scopeFilter);
            const privPct = Math.round(100 - tx.businessSharePct);
            const bizPct = Math.round(tx.businessSharePct);

            return (
              <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                <th scope="row" className="py-3 px-4 font-medium text-white">
                  <div className="flex items-center gap-1.5">
                    {tx.recurringRuleId && (
                      <span title={tx.recurringModified ? "Recurring (edited by hand)" : "Recurring"}>
                        <Repeat
                          className={`w-3 h-3 shrink-0 ${
                            tx.recurringModified ? "text-amber-400" : "text-indigo-400"
                          }`}
                          aria-label="Recurring"
                        />
                      </span>
                    )}
                    <span>{tx.description}</span>
                  </div>
                  {tx.notes && (
                    <div className="text-[11px] text-slate-400 font-normal mt-0.5">{tx.notes}</div>
                  )}
                </th>
                <td className="py-3 px-3 text-slate-300">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
                    style={{
                      backgroundColor: `${folder?.color || "#6366f1"}20`,
                      color: folder?.color || "#818cf8",
                    }}
                  >
                    {folder ? folder.pathNames.slice(1).join(" / ") || "Root" : "Root"}
                  </span>
                </td>
                <td className="py-3 px-3 text-slate-300">
                  <span className="font-medium">{acc?.name || "Account"}</span>
                </td>
                <td className="py-3 px-3">
                  {tx.isSplit ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      Split: {privPct}% Priv / {bizPct}% Biz
                    </span>
                  ) : tx.businessSharePct === 100 ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      Business
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30">
                      Private
                    </span>
                  )}
                </td>
                <td className="py-3 px-3 text-slate-400 tabular-nums">{tx.date}</td>
                <td className="py-3 px-3 text-right tabular-nums">
                  <div
                    className={`font-semibold text-sm ${
                      tx.type === "INCOME" ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {tx.type === "INCOME" ? "+" : "-"}
                    {formatCurrency(effectiveAmount, currency)}
                  </div>
                  {scopeFilter !== "ALL" && tx.isSplit && (
                    <div className="text-[10px] text-slate-500">
                      of {formatCurrency(tx.amount, currency)} total
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(tx)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                      title="Edit transaction"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(tx)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                      title="Delete transaction"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
