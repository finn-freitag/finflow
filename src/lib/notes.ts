/** Tabs that have their own free-text note. Shared by the API, backups and the UI. */
export const NOTE_TABS = ["dashboard", "transactions", "accounts", "recurring"] as const;
export type NoteTab = (typeof NOTE_TABS)[number];
export type TabNotes = Record<NoteTab, string>;

export const MAX_NOTE_LENGTH = 20_000;

export function isNoteTab(value: unknown): value is NoteTab {
  return typeof value === "string" && (NOTE_TABS as readonly string[]).includes(value);
}

export function emptyNotes(): TabNotes {
  return { dashboard: "", transactions: "", accounts: "", recurring: "" };
}

/** Turns database rows into a note per tab (missing tabs are empty). */
export function notesFromRows(rows: { tab: string; content: string }[]): TabNotes {
  const notes = emptyNotes();
  for (const row of rows) if (isNoteTab(row.tab)) notes[row.tab] = row.content;
  return notes;
}
