import { db } from "./dexie";
import type { Item, ItemType } from "../lib/types";
import { newId } from "../lib/validators";

export async function seedIfEmpty(): Promise<void> {
  const count = await db.records.count();
  if (count > 0) return;

  const now = new Date().toISOString();
  const make = (type: ItemType, patch: Partial<Item>): { record_id: string; item: Item } => {
    const item: Item = {
      type,
      title: "",
      tags: [],
      is_favorite: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
      schema_version: 1,
      ...patch,
    } as Item;
    return { record_id: newId(), item };
  };

  const seeds = [
    make("link", { title: "Personal Vault Docs", url: "https://example.com/docs", description: "Specs", tags: ["docs", "vault"], is_favorite: true }),
    make("note", { title: "Welcome note", body: "This is a fixture note for development.", tags: ["inbox"] }),
    make("snippet", { title: "Hello world", content: "console.log('hello');", language: "javascript", tags: ["code"] }),
    make("credential", { title: "Example account", website: "https://example.com", username: "user@example.com", password: "secret123", notes: "dev fixture", tags: ["accounts"] }),
  ];

  await db.transaction("rw", db.records, async () => {
    for (const s of seeds) {
      await db.records.add({
        record_id: s.record_id,
        ciphertext: JSON.stringify(s.item),
        nonce: null,
        schema_version: 1,
        key_version: 1,
        local_revision: 1,
        server_revision: 0,
        sync_state: "synced",
        is_deleted: false,
        updated_at: now,
      });
    }
  });
}