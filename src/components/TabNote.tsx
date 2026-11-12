"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote, X } from "lucide-react";
import { MAX_NOTE_LENGTH, NOTE_TABS, NoteTab, TabNotes, emptyNotes } from "@/lib/notes";

const SAVE_DELAY_MS = 600;

type SaveStatus = "saving" | "saved" | "error";

/**
 * State of the per-tab notes. Typing saves automatically (debounced); unsaved text is also sent
 * when the page is hidden or closed. A note is shown by default when it has text; the "Edit
 * Note" button shows or hides it explicitly.
 */
export function useTabNotes() {
  const [notes, setNotes] = useState<TabNotes>(emptyNotes);
  // Explicit visibility chosen by the user; tabs without an entry follow "has text".
  const [openOverride, setOpenOverride] = useState<Partial<Record<NoteTab, boolean>>>({});
  const [status, setStatus] = useState<Partial<Record<NoteTab, SaveStatus>>>({});
  const [focusTab, setFocusTab] = useState<NoteTab | null>(null);

  const pending = useRef(new Map<NoteTab, string>());
  const timers = useRef(new Map<NoteTab, ReturnType<typeof setTimeout>>());
  // Saves of one tab run one after another, so an older text never overwrites a newer one.
  const chains = useRef(new Map<NoteTab, Promise<void>>());

  const save = useCallback((tab: NoteTab, keepalive = false) => {
    const timer = timers.current.get(tab);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(tab);
    }
    if (!pending.current.has(tab)) return;
    const content = pending.current.get(tab)!;
    pending.current.delete(tab);
    setStatus((s) => ({ ...s, [tab]: "saving" }));

    const run = async () => {
      try {
        const res = await fetch("/api/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab, content }),
          keepalive,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!pending.current.has(tab)) setStatus((s) => ({ ...s, [tab]: "saved" }));
      } catch {
        // Keep the text queued, so the next edit or page hide retries it.
        if (!pending.current.has(tab)) pending.current.set(tab, content);
        setStatus((s) => ({ ...s, [tab]: "error" }));
      }
    };
    const next = (chains.current.get(tab) ?? Promise.resolve()).then(run);
    chains.current.set(tab, next);
  }, []);

  const flushAll = useCallback(
    (keepalive = false) => {
      for (const tab of NOTE_TABS) save(tab, keepalive);
    },
    [save]
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushAll(true);
    };
    const onUnload = () => flushAll(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [flushAll]);

  /** Applies notes loaded from the server, keeping text that is still being saved. */
  const loadNotes = useCallback((server: Partial<TabNotes> | undefined) => {
    setNotes((prev) => {
      const next = emptyNotes();
      for (const tab of NOTE_TABS) {
        next[tab] = pending.current.has(tab) ? prev[tab] : server?.[tab] ?? "";
      }
      return next;
    });
  }, []);

  const change = useCallback(
    (tab: NoteTab, text: string) => {
      setNotes((prev) => ({ ...prev, [tab]: text }));
      // Once edited, the note stays visible even when emptied (until hidden or reloaded).
      setOpenOverride((prev) => (tab in prev ? prev : { ...prev, [tab]: true }));
      pending.current.set(tab, text);
      const timer = timers.current.get(tab);
      if (timer) clearTimeout(timer);
      timers.current.set(
        tab,
        setTimeout(() => save(tab), SAVE_DELAY_MS)
      );
    },
    [save]
  );

  const isOpen = (tab: NoteTab) => openOverride[tab] ?? notes[tab].trim() !== "";

  const toggle = (tab: NoteTab) => {
    const open = !isOpen(tab);
    setOpenOverride((prev) => ({ ...prev, [tab]: open }));
    if (open) setFocusTab(tab);
    else save(tab);
  };

  return {
    notes,
    status,
    isOpen,
    toggle,
    change,
    save,
    loadNotes,
    focusTab,
    clearFocus: () => setFocusTab(null),
  };
}

export type TabNotesState = ReturnType<typeof useTabNotes>;

export function TabNoteButton({ state, tab }: { state: TabNotesState; tab: NoteTab }) {
  const open = state.isOpen(tab);
  return (
    <button
      type="button"
      onClick={() => state.toggle(tab)}
      aria-expanded={open}
      title={open ? "Hide the note of this tab" : "Show and edit the note of this tab"}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
        open
          ? "bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25"
          : "bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
      }`}
    >
      <StickyNote className="w-3.5 h-3.5" />
      {open ? "Hide Note" : "Edit Note"}
    </button>
  );
}

export function TabNotePanel({ state, tab, label }: { state: TabNotesState; tab: NoteTab; label: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { focusTab, clearFocus } = state;

  useEffect(() => {
    if (focusTab === tab && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      clearFocus();
    }
  }, [focusTab, tab, clearFocus]);

  // Grow with the text (up to a limit, then scroll).
  const value = state.notes[tab];
  const open = state.isOpen(tab);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 480)}px`;
  }, [value, open]);

  if (!open) return null;

  const status = state.status[tab];
  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
      ? "Saved"
      : status === "error"
      ? "Not saved, retrying on next change"
      : "Saved automatically";

  return (
    <section className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-3 sm:p-4 shadow-md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <label
          htmlFor={`tab-note-${tab}`}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-200"
        >
          <StickyNote className="w-3.5 h-3.5" />
          Note · {label}
        </label>
        <div className="flex items-center gap-2">
          <span
            aria-live="polite"
            className={`text-[11px] ${status === "error" ? "text-rose-400" : "text-slate-400"}`}
          >
            {statusText}
          </span>
          <button
            type="button"
            onClick={() => state.toggle(tab)}
            aria-label="Hide note"
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <textarea
        id={`tab-note-${tab}`}
        ref={textareaRef}
        value={value}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(e) => state.change(tab, e.target.value)}
        onBlur={() => state.save(tab)}
        placeholder="Write anything you want to remember here…"
        className="w-full resize-y bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50"
      />
    </section>
  );
}
