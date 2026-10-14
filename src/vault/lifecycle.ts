// Vault lifecycle: create / unlock / lock / password-change / recovery-rotate.
// Recovery envelope wraps the SAME DEK — password change touches the master
// envelope only (atomic replace), recovery stays valid. Old exports still open
// with the old password (surfaced in UI disclosures).
import { ensureSodium } from "../crypto/wasm-guard";
import {
  calibrateArgon2,
  type Argon2Params,
} from "../crypto/argon2";
import { generateDEK } from "../crypto/dek";
import {
  deriveLocalCredKey,
  deriveRecordKey,
} from "../crypto/hkdf";
import {
  createMasterEnvelope,
  createRecoveryEnvelope,
  unwrapMasterEnvelope,
  unwrapRecoveryEnvelope,
  type MasterEnvelope,
  type RecoveryEnvelope,
} from "../crypto/envelopes";
import {
  buildRecoveryKit,
  generateRecoverySecret,
  type RecoveryKit,
} from "../crypto/recovery";
import { validatePassphraseLength } from "./passphrase";
import {
  clearSession,
  isLockTimeout,
  setSession,
  type LockTimeoutMinutes,
} from "./session";
import { newVaultId } from "../lib/ids";
import { KEY_VERSION } from "../lib/versions";

export interface CreatedVault {
  vaultId: string;
  masterEnvelope: MasterEnvelope;
  recoveryEnvelope: RecoveryEnvelope;
  recovery_auth_verifier: string;
  recoveryKit: RecoveryKit;
  recoverySecret: Uint8Array;
  argon2Params: Argon2Params;
}

export async function createVault(args: {
  passphrase: string;
  apiOrigin: string;
  lockTimeoutMinutes?: LockTimeoutMinutes;
  calibrate?: () => Promise<number>;
}): Promise<CreatedVault> {
  await ensureSodium(); // fatal gate first — zero vault ops without crypto
  validatePassphraseLength(args.passphrase);
  const vaultId = newVaultId();
  const calibration = await calibrateArgon2(args.calibrate);
  const dek = await generateDEK();
  try {
    const masterEnvelope = await createMasterEnvelope(
      args.passphrase,
      dek,
      { m_kib: calibration.m_kib, t: calibration.t, p: calibration.p },
      KEY_VERSION,
    );
    const recoverySecret = await generateRecoverySecret();
    try {
      const bundle = await createRecoveryEnvelope(dek, recoverySecret, KEY_VERSION);
      const recoveryKit = await buildRecoveryKit({
        vault_id: vaultId,
        api_origin: args.apiOrigin,
        recoverySecret,
      });
      const recEncKey = await deriveRecordKey(dek);
      const localCredKey = await deriveLocalCredKey(dek);
      const timeout = isLockTimeout(args.lockTimeoutMinutes)
        ? args.lockTimeoutMinutes
        : 5;
      setSession({
        vaultId,
        dek: dek.slice(),
        recEncKey,
        localCredKey,
        keyVersion: KEY_VERSION,
        deviceToken: null,
        devicePrivateKey: null,
        lockTimeoutMinutes: timeout,
        lastActivityMs: Date.now(),
      });
      return {
        vaultId,
        masterEnvelope,
        recoveryEnvelope: bundle.envelope,
        recovery_auth_verifier: bundle.recovery_auth_verifier,
        recoveryKit,
        recoverySecret: recoverySecret.slice(),
        argon2Params: {
          m_kib: calibration.m_kib,
          t: calibration.t,
          p: calibration.p,
        },
      };
    } finally {
      recoverySecret.fill(0);
    }
  } finally {
    dek.fill(0);
  }
}

export async function unlockVault(args: {
  vaultId: string;
  passphrase: string;
  masterEnvelope: MasterEnvelope;
  lockTimeoutMinutes?: LockTimeoutMinutes;
}): Promise<void> {
  await ensureSodium();
  validatePassphraseLength(args.passphrase);
  // Fail closed: wrong passphrase throws, nothing wiped remotely or locally.
  const dek = await unwrapMasterEnvelope(args.passphrase, args.masterEnvelope);
  try {
    const recEncKey = await deriveRecordKey(dek);
    const localCredKey = await deriveLocalCredKey(dek);
    const timeout = isLockTimeout(args.lockTimeoutMinutes)
      ? args.lockTimeoutMinutes
      : 5;
    setSession({
      vaultId: args.vaultId,
      dek: dek.slice(),
      recEncKey,
      localCredKey,
      keyVersion: args.masterEnvelope.key_version,
      deviceToken: null,
      devicePrivateKey: null,
      lockTimeoutMinutes: timeout,
      lastActivityMs: Date.now(),
    });
  } finally {
    dek.fill(0);
  }
}

export function lockVault(): void {
  // Memory clear + search-index purge is owned by callers via clearSession
  // subscription; this is the manual-lock entry point.
  clearSession();
}

/**
 * Lock + purge the in-memory search index. App shell must call this (not
 * bare clearSession) so decrypted MiniSearch docs never survive a lock.
 */
export async function lockVaultAndPurge(search?: { clear(): void }): Promise<void> {
  clearSession();
  try {
    search?.clear();
  } catch {
    // purge is best-effort; memory wipe above is the guarantee
  }
}

export interface PasswordChangeResult {
  masterEnvelope: MasterEnvelope;
}

/**
 * Re-wrap the SAME DEK under a new passphrase. Master envelope replaced
 * atomically by the caller (server PUT); recovery envelope untouched so
 * recovery unwrap keeps working.
 */
export async function changePassword(args: {
  oldPassphrase: string;
  newPassphrase: string;
  masterEnvelope: MasterEnvelope;
  calibrate?: () => Promise<number>;
}): Promise<PasswordChangeResult> {
  await ensureSodium();
  validatePassphraseLength(args.newPassphrase);
  const dek = await unwrapMasterEnvelope(args.oldPassphrase, args.masterEnvelope);
  try {
    const calibration = await calibrateArgon2(args.calibrate);
    const masterEnvelope = await createMasterEnvelope(
      args.newPassphrase,
      dek,
      { m_kib: calibration.m_kib, t: calibration.t, p: calibration.p },
      args.masterEnvelope.key_version,
    );
    return { masterEnvelope };
  } finally {
    dek.fill(0);
  }
}

export interface RecoveryRotation {
  recoveryEnvelope: RecoveryEnvelope;
  recovery_auth_verifier: string;
  recoveryKit: RecoveryKit;
  recoverySecret: Uint8Array;
}

/**
 * Rotate recovery: wrap the SAME DEK under a NEW secret. Gate: the caller
 * must confirm the new kit file is saved BEFORE invalidating the old
 * recovery_auth_verifier server-side.
 */
export async function rotateRecovery(args: {
  vaultId: string;
  apiOrigin: string;
  dek: Uint8Array;
  keyVersion?: number;
}): Promise<RecoveryRotation> {
  await ensureSodium();
  const secret = await generateRecoverySecret();
  try {
    const bundle = await createRecoveryEnvelope(
      args.dek,
      secret,
      args.keyVersion ?? KEY_VERSION,
    );
    const recoveryKit = await buildRecoveryKit({
      vault_id: args.vaultId,
      api_origin: args.apiOrigin,
      recoverySecret: secret,
    });
    return {
      recoveryEnvelope: bundle.envelope,
      recovery_auth_verifier: bundle.recovery_auth_verifier,
      recoveryKit,
      recoverySecret: secret.slice(),
    };
  } finally {
    secret.fill(0);
  }
}

/** Clean-profile restore via recovery secret (all-devices-lost flow, step 5). */
export async function restoreViaRecovery(
  recoverySecret: Uint8Array,
  recoveryEnvelope: RecoveryEnvelope,
): Promise<Uint8Array> {
  await ensureSodium();
  return unwrapRecoveryEnvelope(recoverySecret, recoveryEnvelope);
}
