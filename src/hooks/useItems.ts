// Vault item store: local component state fed by the API, with the same
// public shape the UI always had (create/update/remove/favorite/archive/
// duplicate/restore). Refreshes fire on mutation and on window focus, so two
// devices converge by simply refetching the list.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ItemSchema, assertPlaintextSize, type Item } from "../lib/schemas";
import type { ItemWithId } from "../lib/types";
import { newId, validateTags, validateUrl } from "../lib/validators";
import { AuthError, deleteItem, fetchItems, putItem } from "../api/client";

// Cross-instance refresh: every useItems hook in the tree (layout search,
// pages, QuickAdd, tags) re-reads after any mutation, so Ctrl+K never serves
// stale results.
const listeners = new Set<() => void>();
function bumpStore() {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function assertItemValid(item: Item): void {
  ItemSchema.parse(item);
  assertPlaintextSize(item);
  const tagErr = validateTags(item.tags);
  if (tagErr) throw new Error(tagErr);
  if (item.type === "link" && !validateUrl(item.url)) throw new Error("INVALID_URL");
}

export function useItems() {
  const [items, setItems] = useState<ItemWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, forceRefresh] = useReducer((v: number) => v + 1, 0);
  const itemsRef = useRef<ItemWithId[]>([]);

  const refresh = useCallback(async () => {
    try {
      const fetched = await fetchItems();
      fetched.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      itemsRef.current = fetched;
      setItems(fetched);
    } catch (err) {
      if (!(err instanceof AuthError)) {
        // Keep the last known list; the next focus/mutation retries.
        console.warn("items refresh failed:", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  useEffect(() => subscribe(() => forceRefresh()), []);

  // Another device may have written while this tab was hidden.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const create = useCallback(
    async (item: Item): Promise<string> => {
      assertItemValid(item);
      const id = newId();
      const full = { ...item, id } as ItemWithId;
      await putItem(full);
      bumpStore();
      await refresh();
      return id;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Item>) => {
      const current = itemsRef.current.find((i) => i.id === id);
      if (!current) return;
      const next = {
        ...current,
        ...patch,
        updated_at: new Date().toISOString(),
        schema_version: 1,
      } as ItemWithId;
      assertItemValid(next);
      await putItem(next);
      bumpStore();
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteItem(id);
      bumpStore();
      await refresh();
    },
    [refresh],
  );

  const favorite = useCallback(
    async (id: string, value?: boolean) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      await update(id, { is_favorite: value ?? !item.is_favorite });
    },
    [update],
  );

  const archive = useCallback(
    async (id: string, value?: boolean) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      await update(id, { is_archived: value ?? !item.is_archived });
    },
    [update],
  );

  const duplicate = useCallback(
    async (id: string): Promise<string | undefined> => {
      const item = itemsRef.current.find((i) => i.id === id);
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

  const restore = useCallback(
    async (id: string) => {
      await archive(id, false);
    },
    [archive],
  );

  return {
    items,
    loading,
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
