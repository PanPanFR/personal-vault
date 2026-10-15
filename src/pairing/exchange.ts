import { ensureSodium } from "../crypto/wasm-guard";
import { b64uEncodeSync, b64uDecodeSync } from "../crypto/encoding";
import { unwrapMasterEnvelope } from "../crypto/envelopes";
import { deriveLocalCredKey, deriveRecordKey } from "../crypto/hkdf";
import { saveDeviceCredentials } from "../db/encrypted-helpers";
import { type PersonalVaultDB } from "../db/dexie-schema";
import { SyncApiClient } from "../sync/client";
import { SyncEngine } from "../sync/engine";
import { setSession } from "../vault/session";

export interface PairDeviceResult {
  deviceId: string;
  vaultId: string;
}

export async function pairDeviceB(args: {
  db: PersonalVaultDB;
  client: SyncApiClient;
  vaultId: string;
  ticketB64u: string;
  passphrase: string;
  label?: string;
}): Promise<PairDeviceResult> {
  const sodium = await ensureSodium();
  const keypair = sodium.crypto_sign_keypair();
  const deviceId = crypto.randomUUID();
  const publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);
  const defaultLabel =
    args.label && args.label.trim().length > 0
      ? args.label.trim()
      : `Device-${deviceId.slice(0, 4).toUpperCase()}`;

  // Step 2: Exchange ticket
  const exchangeRes = await args.client.exchangePairingTicket({
    vault_id: args.vaultId,
    ticket: args.ticketB64u,
    device_id: deviceId,
    device_public_key: publicKeyB64u,
    label: defaultLabel,
  });

  const rawDeviceToken = b64uDecodeSync(sodium, exchangeRes.device_token);
  const credentials = {
    deviceId,
    rawToken: rawDeviceToken,
    privateKey: keypair.privateKey,
  };

  // Step 3: Bootstrap & unlock
  const bootstrap = await args.client.getBootstrap(args.vaultId, credentials);
  const dek = await unwrapMasterEnvelope(args.passphrase, bootstrap.master_envelope);

  try {
    const localCredKey = await deriveLocalCredKey(dek);
    const recEncKey = await deriveRecordKey(dek);

    // Save encrypted device credentials locally
    await saveDeviceCredentials({
      db: args.db,
      device_id: deviceId,
      rawToken: rawDeviceToken,
      rawPrivateKey: keypair.privateKey,
      publicKeyB64u,
      label: defaultLabel,
      localCredKey,
    });

    // Save vault metadata
    await args.db.app_metadata.put({
      key: "vault",
      vault_id: args.vaultId,
      schema_version: bootstrap.schema_version,
      crypto_format_version: bootstrap.crypto_format_version,
    });

    await args.db.app_metadata.put({
      key: "sync",
      last_sync_cursor: 0,
      last_sync_time: null,
    });

    // Initialize session in memory
    setSession({
      vaultId: args.vaultId,
      dek: dek.slice(),
      recEncKey,
      localCredKey,
      keyVersion: bootstrap.key_version,
      deviceToken: rawDeviceToken.slice(),
      devicePrivateKey: keypair.privateKey.slice(),
      lockTimeoutMinutes: 5,
      lastActivityMs: Date.now(),
    });

    // Step 4: Initial sync from cursor = 0
    const engine = new SyncEngine(args.db, args.client);
    await engine.sync(credentials);

    return { deviceId, vaultId: args.vaultId };
  } finally {
    dek.fill(0);
  }
}
