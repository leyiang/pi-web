export const LAST_CHAT_STORAGE_KEY = "pi-web:last-chat";
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** A manual return destination only. Reading this must never initiate navigation. */
export function getLastChat(storage: StorageLike | null = browserStorage()): string | null {
  try {
    const value = storage?.getItem(LAST_CHAT_STORAGE_KEY)?.trim();
    return value && value.length <= 256 ? value : null;
  } catch { return null; }
}
export function rememberLastChat(id: string, storage: StorageLike | null = browserStorage()): void {
  if (!id.trim() || id.length > 256) return;
  try { if (storage && getLastChat(storage) !== id) storage.setItem(LAST_CHAT_STORAGE_KEY, id); } catch { /* best effort */ }
}
export function forgetLastChat(id: string, storage: StorageLike | null = browserStorage()): void {
  try { if (storage && getLastChat(storage) === id) storage.removeItem(LAST_CHAT_STORAGE_KEY); } catch { /* best effort */ }
}
