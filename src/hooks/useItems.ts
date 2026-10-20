// Vault item store: one shared snapshot fed by the API.
//
// The vault has a single source of truth, so the item list lives in ONE
// module-level store instead of one copy per hook instance. Every consumer
// (layout search, pages, QuickAdd, tags) reads the same snapshot and the app
// fetches the list once per refresh - Ctrl+K can never serve a stale list.
import { useCallback, useSyncExternalStore } from "react";
import { ItemSchema, assertPlaintextSize, type Item } from "../lib/schemas";
import type { ItemWithId } from "../lib/types";
import { newRecordId } from "../lib/ids";
import { validateTags, validateUrl } from "../lib/validators";
import { AuthError, deleteItem, fetchItems, putItem } from "../api/client";

export interface ItemsSnapshot {
  items: ItemWithId[];
  loading: boolean;
}

let snapshot: ItemsSnapshot = { items: [], loading: true };
const listeners = new Set<() => void>();
let loadStarted = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: Partial<ItemsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

function getSnapshot(): ItemsSnapshot {
  return snapshot;
}

export async function refreshItems(): Promise<void> {
  try {
    const fetched = await fetchItems();
    fetched.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    setSnapshot({ items: fetched, loading: false });
  } catch (err) {
    if (!(err instanceof AuthError)) {
      // Keep the last known list; the next focus/mutation retries.
      console.warn("items refresh failed:", err);
    }
    setSnapshot({ loading: false });
  }
}

function onFocus(): void {
  void refreshItems();
}

export function subscribeToItems(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (!loadStarted) {
      loadStarted = true;
      void refreshItems();
    }
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("focus", onFocus);
    }
  };
}

function assertItemValid(item: Item): void {
  ItemSchema.parse(item);
  assertPlaintextSize(item);
  const tagErr = validateTags(item.tags);
  if (tagErr) throw new Error(tagErr);
  if (item.type === "link" && !validateUrl(item.url)) throw new Error("INVALID_URL");
}

function findItem(id: string): ItemWithId | undefined {
  return snapshot.items.find((item) => item.id === id);
}

export function useItems() {
  const state = useSyncExternalStore(subscribeToItems, getSnapshot, getSnapshot);

  const refresh = useCallback(() => refreshItems(), []);

  const create = useCallback(async (item: Item): Promise<string> => {
    assertItemValid(item);
    const id = newRecordId();
    await putItem({ ...item, id } as ItemWithId);
    await refreshItems();
    return id;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Item>) => {
    const current = findItem(id);
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
      schema_version: 1,
    } as ItemWithId;
    assertItemValid(next);
    await putItem(next);
    await refreshItems();
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteItem(id);
    await refreshItems();
  }, []);

  const favorite = useCallback(
    async (id: string, value?: boolean) => {
      const item = findItem(id);
      if (!item) return;
      await update(id, { is_favorite: value ?? !item.is_favorite });
    },
    [update],
  );

  const archive = useCallback(
    async (id: string, value?: boolean) => {
      const item = findItem(id);
      if (!item) return;
      await update(id, { is_archived: value ?? !item.is_archived });
    },
    [update],
  );

  const restore = useCallback(
    async (id: string) => {
      await archive(id, false);
    },
    [archive],
  );

  const duplicate = useCallback(
    async (id: string): Promise<string | undefined> => {
      const item = findItem(id);
      if (!item) return undefined;
      const now = new Date().toISOString();
      const copy: Item = {
        ...item,
        title: `${item.title} (copy)`,
        created_at: now,
        updated_at: now,
        is_archived: false,
      };
      return create(copy);
    },
    [create],
  );

  return {
    items: state.items,
    loading: state.loading,
    refresh,
    create,
    update,
    remove,
    favorite,
    archive,
    restore,
    duplicate,
  };
}

/** Test seam: drop the cached list so each spec starts from a clean vault. */
export function __resetItemsStore(): void {
  snapshot = { items: [], loading: true };
  loadStarted = false;
  listeners.clear();
}
