// Passphrase UX rules — user decision: min 8 chars. Encourage long +
// offline-guess disclosure (bilingual strings live in src/i18n).
import { PASSPHRASE_MIN_LENGTH } from "../lib/limits";

export function validatePassphraseLength(passphrase: string): void {
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) {
    throw new Error(
      `PASSPHRASE_TOO_SHORT: use at least ${PASSPHRASE_MIN_LENGTH} characters.`,
    );
  }
}

export type PassphraseStrength = "weak" | "fair" | "strong";

/** Heuristic only — never blocks, only warns (offline guessing is the threat). */
export function estimatePassphraseStrength(passphrase: string): PassphraseStrength {
  let score = 0;
  if (passphrase.length >= 12) score++;
  if (passphrase.length >= 20) score++;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) score++;
  if (/\d/.test(passphrase)) score++;
  if (/[^A-Za-z0-9]/.test(passphrase)) score++;
  if (score <= 2) return "weak";
  if (score <= 3) return "fair";
  return "strong";
}
