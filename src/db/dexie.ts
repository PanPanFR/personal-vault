// UI-shell Dexie singleton. The schema lives in the frozen foundations
// contract (src/db/dexie-schema.ts) — this module only owns the shared
// instance so every hook talks to one DB version.
import { createDb, type PersonalVaultDB } from "./dexie-schema";

export const db: PersonalVaultDB = createDb();
export type { PersonalVaultDB };
