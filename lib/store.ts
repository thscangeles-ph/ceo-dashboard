import type { InquiryRow, SalesRow, SheetSummary } from "./parse";

/**
 * Keeps the last loaded workbooks on this device (IndexedDB), so the dashboard survives a refresh
 * or closing the app. Nothing leaves the device. Every call fails quietly: private windows and
 * blocked storage simply behave like the app did before (data cleared on close).
 */
export type Workspace = { version: 1; savedAt: Date; sales: SalesRow[]; inquiries: InquiryRow[]; sheets: SheetSummary[] };

const DB = "thsc-ceo-dashboard";
const STORE = "workspace";
const KEY = "current";
const PREF = "thsc-ceo-remember";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const saved = await run<Workspace | undefined>("readonly", (s) => s.get(KEY));
    return saved && saved.version === 1 ? saved : null;
  } catch {
    return null;
  }
}

export async function saveWorkspace(data: Omit<Workspace, "version" | "savedAt">): Promise<Date | null> {
  try {
    const savedAt = new Date();
    await run("readwrite", (s) => s.put({ version: 1, savedAt, ...data } satisfies Workspace, KEY));
    return savedAt;
  } catch {
    return null;
  }
}

export async function clearWorkspace() {
  try { await run("readwrite", (s) => s.delete(KEY)); } catch { /* nothing saved */ }
}

/** Whether to keep data on this device. On by default; switch off on shared computers. */
export function getRemember() {
  try { return localStorage.getItem(PREF) !== "0"; } catch { return true; }
}
export function setRemember(value: boolean) {
  try { localStorage.setItem(PREF, value ? "1" : "0"); } catch { /* storage blocked */ }
}
