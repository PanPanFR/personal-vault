// UI-shell view of the item contract (read-only).
// Source of truth: src/lib/schemas.ts — do not redefine item shapes here.
import type {
  Item,
  LinkItem,
  NoteItem,
  SnippetItem,
  CredentialItem,
} from "./schemas";

export type { Item, LinkItem, NoteItem, SnippetItem, CredentialItem };
export type ItemType = Item["type"];

export type ItemWithId = Item & {
  id: string;
};
