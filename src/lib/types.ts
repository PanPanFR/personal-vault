// UI-shell view of the frozen foundations contract (read-only).
// Source of truth: src/lib/schemas.ts + src/db/dexie-schema.ts — do not
// redefine item shapes here. Crypto plan wraps these with encrypt/decrypt.
import type {
  Item,
  LinkItem,
  NoteItem,
  SnippetItem,
  CredentialItem,
} from "./schemas";
import type { RecordRow } from "../db/dexie-schema";

export type { Item, LinkItem, NoteItem, SnippetItem, CredentialItem };
export type ItemType = Item["type"];
export type SyncState = RecordRow["sync_state"];
export type VaultRecord = RecordRow;

export type ItemWithId = Item & {
  id: string;
};
