import { ensureSodium } from "../crypto/wasm-guard";
import { b64uEncodeSync, b64uDecodeSync } from "../crypto/encoding";
import { deriveRecoveryAuthToken, deriveLocalCredKey, deriveRecordKey } from "../crypto/hkdf";
import { unwrapRecoveryEnvelope, createMasterEnvelope } from "../crypto/envelopes";
import { calibrateArgon2 } from "../crypto/argon2";
import { saveDeviceCredentials } from "../db/encrypted-helpers";
import { type PersonalVaultDB } from "../db/dexie-schema";
import { SyncApiClient } from "../sync/client";
import { SyncEngine } from "../sync/engine";
import { setSession } from "../vault/session";
import { validatePassphraseLength } from "../vault/passphrase";

export interface RecoverVaultResult {
  vaultId: string;
  deviceId: string;
}

export async function recoverAllDevicesLost(args: {
  db: PersonalVaultDB;
  client: SyncApiClient;
  vaultId: string;
  recoverySecret: Uint8Array;
  newPassphrase: string;
  label?: string;
  calibrate?: () => Promise<number>;
}): Promise<RecoverVaultResult> {
  validatePassphraseLength(args.newPassphrase);
  const sodium = await ensureSodium();

  // 1. Derive recovery auth token (raw secret never sent)
  const authToken = await deriveRecoveryAuthToken(args.recoverySecret);
  const authTokenB64u = b64uEncodeSync(sodium, authToken);
  sodium.memzero(authToken);

  // 2. Generate new device keypair
  const keypair = sodium.crypto_sign_keypair();
  const deviceId = crypto.randomUUID();
  const publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);
  const defaultLabel =
    args.label && args.label.trim().length > 0
      ? args.label.trim()
      : `Recovered-${deviceId.slice(0, 4).toUpperCase()}`;

  // 3. Call enroll-device
  const enrollRes = await args.client.recoveryEnrollDevice({
    vault_id: args.vaultId,
    recovery_auth_token: authTokenB64u,
    device_id: deviceId,
    device_public_key: publicKeyB64u,
    label: defaultLabel,
  });

  const rawDeviceToken = b64uDecodeSync(sodium, enrollRes.device_token);
  const credentials = {
    deviceId,
    rawToken: rawDeviceToken,
    privateKey: keypair.privateKey,
  };

  // 4. Unwrap DEK using recovery secret and received recovery_envelope
  const dek = await unwrapRecoveryEnvelope(args.recoverySecret, enrollRes.recovery_envelope);

  try {
    // 5. Calibrate Argon2 and create new master_envelope
    const calibration = await calibrateArgon2(args.calibrate);
    const newMasterEnv = await createMasterEnvelope(
      args.newPassphrase,
      dek,
      { m_kib: calibration.m_kib, t: calibration.t, p: calibration.p },
      enrollRes.recovery_envelope.key_version,
    );

    // 6. Update master envelope on server
    await args.client.updateCryptoMetadata(
      {
        expected_crypto_format_version: 1,
        expected_key_version: enrollRes.recovery_envelope.key_version,
        master_envelope: newMasterEnv,
        recovery_envelope: null,
        recovery_auth_verifier: null,
      },
      credentials,
    );

    // 7. Derive local keys and save local credentials
    const localCredKey = await deriveLocalCredKey(dek);
    const recEncKey = await deriveRecordKey(dek);

    await saveDeviceCredentials({
      db: args.db,
      device_id: deviceId,
      rawToken: rawDeviceToken,
      rawPrivateKey: keypair.privateKey,
      publicKeyB64u,
      label: defaultLabel,
      localCredKey,
    });

    await args.db.app_metadata.put({
      key: "vault",
      vault_id: args.vaultId,
      schema_version: 1,
      crypto_format_version: 1,
    });

    await args.db.app_metadata.put({
      key: "sync",
      last_sync_cursor: 0,
      last_sync_time: null,
    });

    // 8. Unlock session in memory
    setSession({
      vaultId: args.vaultId,
      dek: dek.slice(),
      recEncKey,
      localCredKey,
      keyVersion: enrollRes.recovery_envelope.key_version,
      deviceToken: rawDeviceToken.slice(),
      devicePrivateKey: keypair.privateKey.slice(),
      lockTimeoutMinutes: 5,
      lastActivityMs: Date.now(),
    });

    // 9. Initial resync
    const engine = new SyncEngine(args.db, args.client);
    await engine.sync(credentials);

    return { vaultId: args.vaultId, deviceId };
  } finally {
    dek.fill(0);
  }
}
