"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Wallet } from "lucide-react";
import { AccountFilter, AccountItem } from "@/lib/tree-utils";

const LIST_WIDTH = 256;

interface AccountFilterPickerProps {
  accounts: AccountItem[];
  value: AccountFilter;
  onChange: (value: AccountFilter) => void;
}

/** Normalizes a selection: unknown IDs are dropped, and every account selected means "ALL". */
export function normalizeAccountFilter(ids: readonly string[], accounts: AccountItem[]): AccountFilter {
  const known = accounts.filter((a) => ids.includes(a.id)).map((a) => a.id);
  return known.length === 0 || known.length === accounts.length ? "ALL" : known;
}

export function accountFilterLabel(value: AccountFilter, accounts: AccountItem[]): string {
  if (value === "ALL") return "All Accounts";
  if (value.length === 1) return accounts.find((a) => a.id === value[0])?.name ?? "1 Account";
  return `${value.length} Accounts`;
}

/** Header control to view all accounts, a single one, or any combination of them. */
export function AccountFilterPicker({ accounts, value, onChange }: AccountFilterPickerProps) {
  const [open, setOpen] = useState(false);
  // Horizontal offset of the list relative to the button, keeping it inside the screen.
  const [offsetLeft, setOffsetLeft] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = value === "ALL" ? accounts.map((a) => a.id) : value;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Align the list with the button's right edge, shifted as needed to stay on screen.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(LIST_WIDTH, window.innerWidth - 2 * margin);
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    setOffsetLeft(left - rect.left);
  }, [open]);

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (next.length === 0) return; // at least one account stays in view
    onChange(normalizeAccountFilter(next, accounts));
  };

  const label = accountFilterLabel(value, accounts);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Filter by bank account: ${label}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs max-w-[190px] ${
          value === "ALL"
            ? "bg-slate-900 border-slate-800 text-slate-200"
            : "bg-indigo-600/15 border-indigo-500/40 text-indigo-100"
        }`}
      >
        <Wallet className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Accounts in view"
          style={{ left: offsetLeft, width: LIST_WIDTH, maxWidth: "calc(100vw - 16px)" }}
          className="absolute top-full mt-1.5 z-40 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-1.5"
        >
          <button
            type="button"
            onClick={() => onChange("ALL")}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left text-slate-200 hover:bg-slate-800"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                value === "ALL" ? "bg-indigo-600 border-indigo-500" : "border-slate-600"
              }`}
            >
              {value === "ALL" && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className="font-semibold">All Accounts</span>
          </button>
          <div className="my-1 border-t border-slate-800" />
          <div className="max-h-72 overflow-y-auto">
            {accounts.map((acc) => {
              const checked = selected.includes(acc.id);
              return (
                <div key={acc.id} className="group flex items-center rounded-lg hover:bg-slate-800">
                  <label className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(acc.id)}
                      className="w-4 h-4 accent-indigo-500 shrink-0"
                    />
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                    <span className="truncate">{acc.name}</span>
                    <span className="ml-auto text-[10px] text-slate-500 shrink-0">
                      {acc.scope === "BUSINESS" ? "Biz" : "Priv"}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onChange(normalizeAccountFilter([acc.id], accounts))}
                    title={`Show only ${acc.name}`}
                    className="mr-1 px-1.5 py-0.5 rounded text-[10px] text-indigo-300 hover:bg-indigo-600/30 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                  >
                    Only
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
