"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Maximize2,
  Minimize2,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { CategoryTreeNode, formatCurrency } from "@/lib/tree-utils";
import { TruncatedText } from "./TruncatedText";

interface CategoryTreeProps {
  rootNode: CategoryTreeNode;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onAddSubfolder: (parentId: string | null) => void;
  onEditFolder: (node: CategoryTreeNode) => void;
  onDeleteFolder: (node: CategoryTreeNode) => void;
  onAddTransactionInFolder: (folderId: string | null) => void;
  currency: string;
  wide?: boolean;
  onToggleWide?: () => void;
  /** Leaves a folder (with its subfolders) out of the sums and charts, or counts it again. */
  onToggleExcluded?: (node: CategoryTreeNode) => void;
  excludedCount?: number;
  onIncludeAll?: () => void;
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
  wide = false,
  onToggleWide,
  onToggleExcluded,
  excludedCount = 0,
  onIncludeAll,
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
    // Not counted in the sums of its parents and Root (shown dimmed).
    const notCounted = node.excluded || node.insideExcluded;

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
          // Nesting is indented by the subfolder wrapper below; no extra depth padding here.
          style={{ paddingLeft: isRoot ? "0.75rem" : "0.4rem" }}
          className={`group relative flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 py-2.5 pr-3 rounded-xl cursor-pointer transition-all border ${
            isSelected
              ? "bg-indigo-600/20 border-indigo-500/60 text-white shadow-sm"
              : "bg-transparent border-transparent hover:bg-slate-800/75 text-slate-200"
          }`}
        >
          {/* Left: Expand toggle + Folder icon + Name + Count */}
          <div className={`flex items-center gap-2 min-w-0 flex-1 ${notCounted ? "opacity-50" : ""}`}>
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
                <TruncatedText
                  text={node.name}
                  fullText={node.pathNames.join(" / ")}
                  clampClassName="line-clamp-2 sm:line-clamp-1"
                  className={`text-sm ${isRoot ? "font-semibold" : "font-medium"}`}
                />
                {node.totalTransactionCount > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-normal shrink-0">
                    {node.totalTransactionCount}
                  </span>
                )}
              </div>
              {isRoot && excludedCount > 0 && (
                <div className="text-[11px] text-amber-300/90 mt-0.5">
                  Without {excludedCount} excluded {excludedCount === 1 ? "folder" : "folders"}
                </div>
              )}

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

          {/* Right: Current Sum (Net) */}
          <div className="flex items-center gap-2 shrink-0">
            {node.excluded && onToggleExcluded && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExcluded(node);
                }}
                title={`${node.name} is excluded from the sums and charts. Click to include it again.`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
              >
                <EyeOff className="w-3 h-3" />
                Excluded
              </button>
            )}
            <div className={`text-right ${notCounted ? "opacity-50" : ""}`}>
              <div className={`text-sm font-semibold tabular-nums ${netColor}`}>
                {formatCurrency(node.totalNet, currency, true)}
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                {isRoot ? "Root Sum" : hasChildren ? "Folder + Sub" : "Folder Sum"}
              </div>
            </div>
          </div>

          {/* Phones: actions on their own line below the selected folder (tap a folder to see them).
              Larger screens: actions float over the sum on hover instead of reserving width. */}
          <div
            className={`${isSelected ? "flex" : "hidden"} basis-full justify-end items-center gap-0.5 transition-opacity sm:flex sm:basis-auto sm:absolute sm:right-2 sm:top-1/2 sm:-translate-y-1/2 sm:z-10 sm:rounded-lg sm:border sm:border-slate-700 sm:bg-slate-900/95 sm:px-1 sm:py-0.5 sm:shadow-lg sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto sm:focus-within:opacity-100 sm:focus-within:pointer-events-auto`}
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
                {onToggleExcluded && (
                  <button
                    type="button"
                    title={
                      node.excluded
                        ? `Include ${node.name} in the sums and charts again`
                        : `Exclude ${node.name} (and its subfolders) from the sums and charts`
                    }
                    aria-pressed={node.excluded}
                    onClick={() => onToggleExcluded(node)}
                    className={`p-1.5 rounded-lg hover:bg-slate-800 ${
                      node.excluded ? "text-amber-300 hover:text-white" : "text-slate-400 hover:text-amber-300"
                    }`}
                  >
                    {node.excluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                )}
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

        {/* Render Subfolders recursively */}
        {hasChildren && !isCollapsed && (
          <div className="mt-0.5 space-y-0.5 border-l border-slate-800/70 ml-3 pl-1 sm:ml-4 sm:pl-1.5">
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
          {excludedCount > 0 && (
            <p className="text-xs text-amber-300/90 mt-1 flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1">
                <EyeOff className="w-3 h-3" />
                {excludedCount} {excludedCount === 1 ? "folder is" : "folders are"} excluded from sums and charts.
              </span>
              {onIncludeAll && (
                <button type="button" onClick={onIncludeAll} className="underline hover:text-white">
                  Include all
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onToggleWide && (
            <button
              type="button"
              onClick={onToggleWide}
              title={wide ? "Show tree next to the charts" : "Show tree in full width"}
              aria-pressed={wide}
              className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors"
            >
              {wide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {wide ? "Side by side" : "Wide view"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onAddSubfolder(selectedFolderId)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            New Folder
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[75vh] overflow-y-auto pr-1">{renderNode(rootNode)}</div>
    </div>
  );
}
