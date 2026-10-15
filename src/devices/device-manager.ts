import { type PersonalVaultDB } from "../db/dexie-schema";
import { SyncApiClient, type DeviceCredentials } from "../sync/client";

export class DeviceManager {
  private db: PersonalVaultDB;
  private client: SyncApiClient;

  constructor(db: PersonalVaultDB, client: SyncApiClient) {
    this.db = db;
    this.client = client;
  }

  public async getLocalDevice(): Promise<{
    deviceId: string;
    publicKey: string;
    label: string;
  } | null> {
    const row = await this.db.device_credentials.toCollection().first();
    if (!row) return null;
    return {
      deviceId: row.device_id,
      publicKey: row.public_key,
      label: row.label,
    };
  }

  public async renameLocalDevice(newLabel: string): Promise<void> {
    const row = await this.db.device_credentials.toCollection().first();
    if (!row) throw new Error("No local device registered.");
    await this.db.device_credentials.update(row.device_id, { label: newLabel.trim() });
  }

  public async revokeDevice(
    targetDeviceId: string,
    credentials: DeviceCredentials,
  ): Promise<{ device_id: string; revoked_at: string; status: string }> {
    return this.client.revokeDevice(targetDeviceId, credentials);
  }
}
