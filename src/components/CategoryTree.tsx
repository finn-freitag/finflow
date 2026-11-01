"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { CategoryTreeNode, formatCurrency } from "@/lib/tree-utils";

interface CategoryTreeProps {
  rootNode: CategoryTreeNode;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onAddSubfolder: (parentId: string | null) => void;
  onEditFolder: (node: CategoryTreeNode) => void;
  onDeleteFolder: (node: CategoryTreeNode) => void;
  onAddTransactionInFolder: (folderId: string | null) => void;
  currency: string;
}

export function CategoryTree({
  rootNode,
  selectedFolderId,
  onSelectFolder,
  onAddSubfolder,
  onEditFolder,
  onDeleteFolder,
  onAddTransactionInFolder,
  currency,
}: CategoryTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderNode = (node: CategoryTreeNode) => {
    const isRoot = node.id === null;
    const isSelected = selectedFolderId === node.id;
    const hasChildren = node.children.length > 0;
    const isCollapsed = node.id ? collapsedIds.has(node.id) : false;

    const netColor =
      node.totalNet > 0
        ? "text-emerald-400"
        : node.totalNet < 0
        ? "text-rose-400"
        : "text-slate-400";

    return (
      <div key={node.id ?? "root"} className="select-none">
        <div
          onClick={() => onSelectFolder(node.id)}
          style={{ paddingLeft: isRoot ? "0.75rem" : `${node.depth * 1.15 + 0.5}rem` }}
          className={`group flex items-center justify-between gap-2 py-2.5 pr-3 rounded-xl cursor-pointer transition-all border ${
            isSelected
              ? "bg-indigo-600/20 border-indigo-500/60 text-white shadow-sm"
              : "bg-transparent border-transparent hover:bg-slate-800/75 text-slate-200"
          }`}
        >
          {/* Left: Expand toggle + Folder icon + Name + Count */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {!isRoot ? (
              hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(node.id!, e)}
                  aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                  className="p-0.5 rounded hover:bg-slate-700/70 text-slate-400 hover:text-white transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <span className="w-5 inline-block" />
              )
            ) : null}

            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{
                backgroundColor: isRoot ? "rgba(99, 102, 241, 0.2)" : `${node.color}22`,
                color: isRoot ? "#818cf8" : node.color,
              }}
            >
              {isRoot ? (
                <Layers className="w-4 h-4" />
              ) : hasChildren && !isCollapsed ? (
                <FolderOpen className="w-4 h-4" />
              ) : (
                <Folder className="w-4 h-4" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-sm ${isRoot ? "font-semibold" : "font-medium"}`}>
                  {node.name}
                </span>
                {node.totalTransactionCount > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-normal shrink-0">
                    {node.totalTransactionCount}
                  </span>
                )}
              </div>

              {/* Sub-details if folder has both direct transactions and subfolder rollups, or expenses + income */}
              {(node.totalExpense > 0 || node.totalIncome > 0) && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                  {node.totalExpense > 0 && (
                    <span>
                      Out: <span className="text-rose-400/90">-{formatCurrency(node.totalExpense, currency)}</span>
                    </span>
                  )}
                  {node.totalIncome > 0 && (
                    <span>
                      In: <span className="text-emerald-400/90">+{formatCurrency(node.totalIncome, currency)}</span>
                    </span>
                  )}
                  {!isRoot && hasChildren && node.directTransactionCount > 0 && (
                    <span className="text-slate-500">
                      (Direct: {formatCurrency(node.directNet, currency, true)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Current Sum (Net) + Quick Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className={`text-sm font-semibold tabular-nums ${netColor}`}>
                {formatCurrency(node.totalNet, currency, true)}
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                {isRoot ? "Root Sum" : hasChildren ? "Folder + Sub" : "Folder Sum"}
              </div>
            </div>

            <div
              className="flex items-center gap-0.5 opacity-85 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title={`Add transaction in ${node.name}`}
                onClick={() => onAddTransactionInFolder(node.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
              >
                <PlusCircle className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={`Add subfolder inside ${node.name}`}
                onClick={() => onAddSubfolder(node.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              {!isRoot && (
                <>
                  <button
                    type="button"
                    title={`Edit ${node.name}`}
                    onClick={() => onEditFolder(node)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title={`Delete ${node.name}`}
                    onClick={() => onDeleteFolder(node)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Render Subfolders recursively */}
        {hasChildren && !isCollapsed && (
          <div className="mt-0.5 space-y-0.5 border-l border-slate-800/70 ml-4">
            {node.children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            Category Folder Tree
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Click any folder to filter charts & transactions. Sums roll up all subfolders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAddSubfolder(selectedFolderId)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-colors shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          New Folder
        </button>
      </div>

      <div className="space-y-1 max-h-[540px] overflow-y-auto pr-1">{renderNode(rootNode)}</div>
    </div>
  );
}
