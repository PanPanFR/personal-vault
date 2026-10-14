import { useCallback, useEffect, useReducer, useState } from "react";
import { db } from "../db/dexie";
import { seedIfEmpty } from "../db/seed";
import { ItemSchema, assertPlaintextSize, type Item } from "../lib/schemas";
import type { ItemWithId, VaultRecord } from "../lib/types";
import { newId, validateTags, validateUrl } from "../lib/validators";
import type { RecordRow } from "../db/dexie-schema";

// Cross-instance refresh: every useItems hook in the tree (layout search,
// pages, QuickAdd, tags) re-reads after any mutation, so Ctrl+K never serves
// stale fixtures.
let storeVersion = 0;
const listeners = new Set<() => void>();
function bumpStore() {
  storeVersion += 1;
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function recordToItem(r: VaultRecord): ItemWithId | null {
  if (!r.ciphertext || r.is_deleted) return null;
  try {
    // Fixture stand-in: plaintext JSON in the ciphertext column. The crypto
    // plan replaces this parse with real decryption (same return shape).
    const item = ItemSchema.parse(JSON.parse(r.ciphertext));
    return { ...item, id: r.record_id };
  } catch {
    return null;
  }
}

function assertItemValid(item: Item): void {
  // Frozen schema check (field shapes, tag caps) + 256 KiB pre-encrypt guard.
  ItemSchema.parse(item);
  assertPlaintextSize(item);
  const tagErr = validateTags(item.tags);
  if (tagErr) throw new Error(tagErr);
  if (item.type === "link" && !validateUrl(item.url))
    throw new Error("INVALID_URL");
}

export function useItems() {
  const [items, setItems] = useState<ItemWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, forceRefresh] = useReducer((v: number) => v + 1, 0);

  const refresh = useCallback(async () => {
    await seedIfEmpty();
    const records = await db.records.toArray();
    const parsed = records.map(recordToItem).filter(Boolean) as ItemWithId[];
    parsed.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    setItems(parsed);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  useEffect(() => subscribe(() => forceRefresh()), []);

  const create = useCallback(
    async (item: Item): Promise<string> => {
      assertItemValid(item);
      const id = newId();
      const record: RecordRow = {
        record_id: id,
        ciphertext: JSON.stringify(item),
        nonce: null,
        schema_version: 1,
        key_version: 1,
        local_revision: 1,
        server_revision: 0,
        sync_state: "pending",
        is_deleted: false,
        updated_at: item.updated_at,
      };
      await db.records.add(record);
      bumpStore();
      await refresh();
      return id;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Item>) => {
      const rec = await db.records.get(id);
      if (!rec || !rec.ciphertext) return;
      const current = ItemSchema.parse(JSON.parse(rec.ciphertext));
      const next = {
        ...current,
        ...patch,
        updated_at: new Date().toISOString(),
        schema_version: 1,
      } as Item;
      assertItemValid(next);
      await db.records.update(id, {
        ciphertext: JSON.stringify(next),
        updated_at: next.updated_at,
        sync_state: "pending",
        local_revision: rec.local_revision + 1,
      });
      bumpStore();
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await db.records.delete(id);
      bumpStore();
      await refresh();
    },
    [refresh],
  );

  const favorite = useCallback(
    async (id: string, value?: boolean) => {
      const rec = await db.records.get(id);
      if (!rec?.ciphertext) return;
      const item = ItemSchema.parse(JSON.parse(rec.ciphertext));
      await update(id, { is_favorite: value ?? !item.is_favorite });
    },
    [update],
  );

  const archive = useCallback(
    async (id: string, value?: boolean) => {
      const rec = await db.records.get(id);
      if (!rec?.ciphertext) return;
      const item = ItemSchema.parse(JSON.parse(rec.ciphertext));
      await update(id, { is_archived: value ?? !item.is_archived });
    },
    [update],
  );

  const duplicate = useCallback(
    async (id: string): Promise<string | undefined> => {
      const rec = await db.records.get(id);
      if (!rec?.ciphertext) return;
      const item = ItemSchema.parse(JSON.parse(rec.ciphertext));
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
