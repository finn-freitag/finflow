"use client";

import React, { useState } from "react";
import { ChevronRight, PieChart as PieChartIcon } from "lucide-react";
import { AccountItem, formatCurrency } from "@/lib/tree-utils";
import { TruncatedText } from "./TruncatedText";

type GroupMode = "ACCOUNT" | "TYPE" | "SCOPE";

interface AccountDistributionChartProps {
  accounts: AccountItem[];
  /** Current balance per account id (same numbers as the account cards). */
  balances: Map<string, { balance: number }>;
  currency: string;
  /** Called when an account slice/row is clicked (only in "By account" mode). */
  onSelectAccount?: (accountId: string) => void;
}

interface Slice {
  key: string;
  name: string;
  color: string;
  amount: number;
  accountId?: string;
  detail?: string;
}

const TYPE_LABELS: Record<AccountItem["type"], string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  CREDIT_CARD: "Credit Card",
  CASH: "Cash",
  INVESTMENT: "Investment",
};

const TYPE_COLORS: Record<AccountItem["type"], string> = {
  CHECKING: "#6366f1",
  SAVINGS: "#10b981",
  CREDIT_CARD: "#f43f5e",
  CASH: "#f59e0b",
  INVESTMENT: "#06b6d4",
};

const SCOPE_COLORS = { PRIVATE: "#8b5cf6", BUSINESS: "#38bdf8" };

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildSlices(
  accounts: AccountItem[],
  balances: Map<string, { balance: number }>,
  mode: GroupMode
): Slice[] {
  const balanceOf = (acc: AccountItem) =>
    round2(balances.get(acc.id)?.balance ?? Number(acc.initialBalance || 0));

  if (mode === "ACCOUNT") {
    return accounts.map((acc) => ({
      key: acc.id,
      name: acc.name,
      color: acc.color,
      amount: balanceOf(acc),
      accountId: acc.id,
      detail: `${acc.scope === "BUSINESS" ? "Business" : "Private"} · ${TYPE_LABELS[acc.type]}`,
    }));
  }

  // Group by type or scope. Each account's balance goes into its group, so a negative account
  // (e.g. a credit card) reduces its group's total.
  const groups = new Map<string, Slice & { count: number }>();
  for (const acc of accounts) {
    const key = mode === "TYPE" ? acc.type : acc.scope;
    const g = groups.get(key) ?? {
      key,
      name: mode === "TYPE" ? TYPE_LABELS[acc.type] : acc.scope === "BUSINESS" ? "Business" : "Private",
      color: mode === "TYPE" ? TYPE_COLORS[acc.type] : SCOPE_COLORS[acc.scope],
      amount: 0,
      count: 0,
    };
    g.amount = round2(g.amount + balanceOf(acc));
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map(({ count, ...g }) => ({
    ...g,
    detail: `${count} account${count === 1 ? "" : "s"}`,
  }));
}

export function AccountDistributionChart({
  accounts,
  balances,
  currency,
  onSelectAccount,
}: AccountDistributionChartProps) {
  const [mode, setMode] = useState<GroupMode>("ACCOUNT");

  const all = buildSlices(accounts, balances, mode);
  // A pie can only show positive amounts; negative balances are listed below it instead.
  const positive = all.filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  const negative = all.filter((s) => s.amount < 0).sort((a, b) => a.amount - b.amount);
  const empty = all.filter((s) => s.amount === 0);
  const totalPositive = round2(positive.reduce((sum, s) => sum + s.amount, 0));
  const totalNegative = round2(negative.reduce((sum, s) => sum + s.amount, 0));
  const netTotal = round2(totalPositive + totalNegative);

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  const clickable = (s: Slice) => mode === "ACCOUNT" && !!s.accountId && !!onSelectAccount;
  const pctOf = (s: Slice) => (totalPositive > 0 ? (s.amount / totalPositive) * 100 : 0);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Money per Account</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Where your current balance sits{mode === "ACCOUNT" ? " (click an account to see its transactions)" : ""}
          </p>
        </div>

        <div
          role="group"
          aria-label="Group balances"
          className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800"
        >
          {(
            [
              ["ACCOUNT", "By account"],
              ["TYPE", "By type"],
              ["SCOPE", "Private vs Business"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === value
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {positive.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">
          {accounts.length === 0
            ? "No accounts yet."
            : "None of your accounts has a positive balance right now."}
          {negative.length > 0 && (
            <div className="mt-1 text-rose-400 tabular-nums">
              Total debt: {formatCurrency(totalNegative, currency)}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row gap-4 sm:items-center">
          {/* Donut */}
          <div className="shrink-0 flex flex-col items-center justify-center">
            <div className="relative w-44 h-44 flex items-center justify-center">
              <svg className="w-44 h-44 -rotate-90" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r={radius} fill="transparent" stroke="#1e293b" strokeWidth="20" />
                {positive.map((s) => {
                  const fraction = s.amount / totalPositive;
                  const dash = `${fraction * circumference} ${circumference}`;
                  const offset = -cumulative * circumference;
                  cumulative += fraction;
                  const label = `${s.name}: ${formatCurrency(s.amount, currency)} (${pctOf(s).toFixed(1)}%)`;
                  return (
                    <circle
                      key={s.key}
                      aria-label={label}
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="transparent"
                      stroke={s.color}
                      strokeWidth="20"
                      strokeDasharray={dash}
                      strokeDashoffset={offset}
                      className={clickable(s) ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}
                      onClick={() => clickable(s) && onSelectAccount?.(s.accountId!)}
                    >
                      <title>{label}</title>
                    </circle>
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                <span className="text-[11px] uppercase tracking-wider text-slate-400">
                  {negative.length > 0 ? "Assets" : "Total"}
                </span>
                <span className="text-base font-bold text-white mt-0.5 tabular-nums">
                  {formatCurrency(totalPositive, currency)}
                </span>
              </div>
            </div>
            {negative.length > 0 && (
              <div className="mt-2 text-[11px] text-slate-400 text-center tabular-nums">
                Net after debts:{" "}
                <span className={`font-semibold ${netTotal >= 0 ? "text-slate-100" : "text-rose-400"}`}>
                  {formatCurrency(netTotal, currency)}
                </span>
              </div>
            )}
          </div>

          {/* Breakdown rows */}
          <div className="flex-1 min-w-0 space-y-2 max-h-72 overflow-y-auto pr-1">
            {positive.map((s) => {
              const pct = pctOf(s);
              const canClick = clickable(s);
              return (
                <div
                  key={s.key}
                  onClick={() => canClick && onSelectAccount?.(s.accountId!)}
                  title={canClick ? `View ${s.name} transactions` : undefined}
                  className={`p-2 rounded-xl border border-slate-800/80 bg-slate-950/40 ${
                    canClick ? "cursor-pointer hover:border-slate-700 hover:bg-slate-800/40 transition-colors" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <TruncatedText
                      text={s.name}
                      fullText={`${s.name}${s.detail ? ` (${s.detail})` : ""}: ${formatCurrency(s.amount, currency)} (${pct.toFixed(1)}%)`}
                      className="flex-1 font-medium text-slate-200"
                    />
                    {canClick && <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                    <span className="font-semibold text-slate-100 tabular-nums shrink-0">
                      {formatCurrency(s.amount, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: s.color }}
                      />
                    </div>
                    <span className="w-11 text-right text-[10px] text-slate-400 tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}

            {(negative.length > 0 || empty.length > 0) && (
              <div className="pt-1 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Not in chart</div>
                {[...negative, ...empty].map((s) => (
                  <div
                    key={s.key}
                    onClick={() => clickable(s) && onSelectAccount?.(s.accountId!)}
                    className={`flex items-center gap-2 px-2 py-1 text-xs rounded-lg ${
                      clickable(s) ? "cursor-pointer hover:bg-slate-800/40" : ""
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <TruncatedText text={s.name} className="flex-1 text-slate-300" />
                    <span
                      className={`tabular-nums shrink-0 ${s.amount < 0 ? "text-rose-400" : "text-slate-500"}`}
                    >
                      {formatCurrency(s.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
