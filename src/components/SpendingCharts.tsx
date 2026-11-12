"use client";

import React, { useState } from "react";
import { ArrowUpLeft, BarChart3, ChevronRight, PieChart as PieChartIcon } from "lucide-react";
import {
  CategoryTreeNode,
  FolderBreakdownSlice,
  MonthlyChartPoint,
  formatCurrency,
  getFolderSpendingBreakdown,
} from "@/lib/tree-utils";
import { TruncatedText } from "./TruncatedText";

interface SpendingChartsProps {
  activeNode: CategoryTreeNode;
  onSelectFolder: (folderId: string | null) => void;
  monthlySeries: MonthlyChartPoint[];
  selectedYear: number;
  selectedMonth: number;
  periodLabel: string;
  currency: string;
  onSelectMonth?: (month: number) => void;
  /** Charts area spans the full width (tree in wide view): show both charts side by side. */
  wide?: boolean;
}

export function SpendingCharts({
  activeNode,
  onSelectFolder,
  monthlySeries,
  selectedYear,
  selectedMonth,
  periodLabel,
  currency,
  onSelectMonth,
  wide = false,
}: SpendingChartsProps) {
  const [breakdownMode, setBreakdownMode] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [barChartMode, setBarChartMode] = useState<"EXPENSE_INCOME" | "PRIVATE_BUSINESS">(
    "EXPENSE_INCOME"
  );

  const slices: FolderBreakdownSlice[] = getFolderSpendingBreakdown(activeNode, breakdownMode);
  const totalAmount =
    breakdownMode === "EXPENSE" ? activeNode.totalExpense : activeNode.totalIncome;

  // Build SVG Donut arcs
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let cumulativePercent = 0;

  const maxMonthlyVal = Math.max(
    100,
    ...monthlySeries.map((m) =>
      barChartMode === "EXPENSE_INCOME"
        ? Math.max(m.expense, m.income)
        : Math.max(m.privateExpense + m.businessExpense, 1)
    )
  );

  return (
    <div className={`grid grid-cols-1 gap-4 ${wide ? "xl:grid-cols-2" : ""}`}>
      {/* Chart 1: Spending / Income per Folder (Donut + Drilldown Bars) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">
                  {breakdownMode === "EXPENSE" ? "Spending" : "Income"} per Folder ({periodLabel})
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Viewing:{" "}
                <span className="text-indigo-300 font-medium">
                  {activeNode.pathNames.join(" / ")}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {activeNode.id !== null && (
                <button
                  type="button"
                  onClick={() => onSelectFolder(activeNode.parentId)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <ArrowUpLeft className="w-3.5 h-3.5" />
                  Up Level
                </button>
              )}
              <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setBreakdownMode("EXPENSE")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    breakdownMode === "EXPENSE"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Expenses
                </button>
                <button
                  type="button"
                  onClick={() => setBreakdownMode("INCOME")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    breakdownMode === "INCOME"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Income
                </button>
              </div>
            </div>
          </div>

          {slices.length === 0 || totalAmount <= 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No {breakdownMode.toLowerCase()}s recorded in{" "}
              <span className="text-slate-200 font-medium">{activeNode.name}</span> for{" "}
              {periodLabel}.
            </div>
          ) : (
            <div className="mt-4 flex flex-col sm:flex-row xl:flex-col 2xl:flex-row gap-4 sm:items-center xl:items-stretch 2xl:items-center">
              {/* Donut beside the list, except at xl where the card is only ~half the content width.
                  The donut has a fixed size; the folder list takes the remaining width. */}
              <div className="shrink-0 flex flex-col items-center justify-center">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-44 h-44 -rotate-90" viewBox="0 0 160 160">
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="transparent"
                      stroke="#1e293b"
                      strokeWidth="20"
                    />
                    {slices.map((slice, i) => {
                      const val = breakdownMode === "EXPENSE" ? slice.expense : slice.income;
                      const pct = totalAmount > 0 ? val / totalAmount : 0;
                      const strokeDasharray = `${pct * circumference} ${circumference}`;
                      const strokeDashoffset = -cumulativePercent * circumference;
                      cumulativePercent += pct;

                      return (
                        <circle
                          key={`${slice.id ?? "direct"}-${i}`}
                          aria-label={`${slice.name}: ${formatCurrency(val, currency)} (${slice.percentage.toFixed(1)}%)`}
                          cx="80"
                          cy="80"
                          r={radius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="20"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          className={
                            slice.canDrillDown
                              ? "cursor-pointer hover:opacity-80 transition-opacity"
                              : ""
                          }
                          onClick={() => {
                            if (slice.canDrillDown) onSelectFolder(slice.id);
                          }}
                        >
                          <title>
                            {`${slice.name}: ${formatCurrency(val, currency)} (${slice.percentage.toFixed(1)}%)`}
                          </title>
                        </circle>
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400">
                      Total {breakdownMode === "EXPENSE" ? "Spent" : "Income"}
                    </span>
                    <span className="text-base font-bold text-white mt-0.5 tabular-nums">
                      {formatCurrency(totalAmount, currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Folder Breakdown Bars */}
              <div className="flex-1 min-w-0 space-y-2 max-h-72 overflow-y-auto pr-1">
                {slices.map((slice, idx) => {
                  const amount = breakdownMode === "EXPENSE" ? slice.expense : slice.income;
                  const amountText = formatCurrency(amount, currency);
                  return (
                    <div
                      key={`${slice.id ?? "direct"}-${idx}`}
                      onClick={() => {
                        if (slice.canDrillDown) onSelectFolder(slice.id);
                      }}
                      title={slice.canDrillDown ? `Open ${slice.name}` : undefined}
                      className={`group p-2 rounded-xl border border-slate-800/80 bg-slate-950/50 transition-colors ${
                        slice.canDrillDown
                          ? "cursor-pointer hover:border-indigo-500/50 hover:bg-slate-800/60"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: slice.color }}
                          />
                          <TruncatedText
                            text={slice.name}
                            fullText={`${slice.name}: ${amountText} (${slice.percentage.toFixed(1)}%)`}
                            className="font-medium text-slate-200"
                          />
                          {slice.canDrillDown && (
                            <ChevronRight
                              aria-label="Drill in"
                              className="w-3.5 h-3.5 shrink-0 text-indigo-400/70 group-hover:text-indigo-300"
                            />
                          )}
                        </div>
                        <span className="shrink-0 font-semibold text-white tabular-nums">{amountText}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(2, slice.percentage))}%`,
                              backgroundColor: slice.color,
                            }}
                          />
                        </div>
                        <span className="shrink-0 w-11 text-right text-[11px] text-slate-400 tabular-nums">
                          {slice.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart 2: Yearly Monthly Breakdown (Expenses vs Income OR Private vs Business) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Monthly Overview ({selectedYear})
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Folder:{" "}
                <span className="text-emerald-300 font-medium">{activeNode.name}</span> (click a
                month to inspect)
              </p>
            </div>

            <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
              <button
                type="button"
                onClick={() => setBarChartMode("EXPENSE_INCOME")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  barChartMode === "EXPENSE_INCOME"
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                In vs Out
              </button>
              <button
                type="button"
                onClick={() => setBarChartMode("PRIVATE_BUSINESS")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  barChartMode === "PRIVATE_BUSINESS"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Private vs Business
              </button>
            </div>
          </div>

          {/* 12-Month Interactive Bar Chart */}
          <div className="mt-5 pt-2">
            <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-44 px-1">
              {monthlySeries.map((pt) => {
                const isSelectedMonth = pt.monthIndex === selectedMonth;
                if (barChartMode === "EXPENSE_INCOME") {
                  const expH = Math.round((pt.expense / maxMonthlyVal) * 100);
                  const incH = Math.round((pt.income / maxMonthlyVal) * 100);
                  return (
                    <div
                      key={pt.label}
                      onClick={() => onSelectMonth?.(pt.monthIndex)}
                      title={`${pt.label} ${selectedYear}\nIncome: ${formatCurrency(
                        pt.income,
                        currency
                      )}\nExpense: ${formatCurrency(pt.expense, currency)}`}
                      className={`group flex flex-col items-center h-full justify-end cursor-pointer rounded-lg p-1 transition-colors ${
                        isSelectedMonth ? "bg-indigo-500/15 ring-1 ring-indigo-500/40" : "hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="w-full flex items-end justify-center gap-0.5 h-32">
                        <div
                          style={{ height: `${Math.max(incH, pt.income > 0 ? 5 : 0)}%` }}
                          className="w-2 sm:w-2.5 bg-emerald-500 rounded-t transition-all"
                        />
                        <div
                          style={{ height: `${Math.max(expH, pt.expense > 0 ? 5 : 0)}%` }}
                          className="w-2 sm:w-2.5 bg-rose-500 rounded-t transition-all"
                        />
                      </div>
                      <span
                        className={`text-[10px] mt-1.5 ${
                          isSelectedMonth ? "text-indigo-300 font-semibold" : "text-slate-400"
                        }`}
                      >
                        {pt.label}
                      </span>
                    </div>
                  );
                } else {
                  const privH = Math.round((pt.privateExpense / maxMonthlyVal) * 100);
                  const bizH = Math.round((pt.businessExpense / maxMonthlyVal) * 100);
                  return (
                    <div
                      key={pt.label}
                      onClick={() => onSelectMonth?.(pt.monthIndex)}
                      title={`${pt.label} ${selectedYear}\nPrivate Spent: ${formatCurrency(
                        pt.privateExpense,
                        currency
                      )}\nBusiness Spent: ${formatCurrency(pt.businessExpense, currency)}`}
                      className={`group flex flex-col items-center h-full justify-end cursor-pointer rounded-lg p-1 transition-colors ${
                        isSelectedMonth ? "bg-sky-500/15 ring-1 ring-sky-500/40" : "hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="w-full flex items-end justify-center gap-0.5 h-32">
                        <div
                          style={{ height: `${Math.max(privH, pt.privateExpense > 0 ? 5 : 0)}%` }}
                          className="w-2 sm:w-2.5 bg-violet-500 rounded-t transition-all"
                        />
                        <div
                          style={{ height: `${Math.max(bizH, pt.businessExpense > 0 ? 5 : 0)}%` }}
                          className="w-2 sm:w-2.5 bg-sky-400 rounded-t transition-all"
                        />
                      </div>
                      <span
                        className={`text-[10px] mt-1.5 ${
                          isSelectedMonth ? "text-sky-300 font-semibold" : "text-slate-400"
                        }`}
                      >
                        {pt.label}
                      </span>
                    </div>
                  );
                }
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-5 mt-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
              {barChartMode === "EXPENSE_INCOME" ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    Income
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                    Expenses
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-violet-500" />
                    Private Share
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                    Business Share
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
