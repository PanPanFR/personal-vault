import { ensureSodium } from "../crypto/wasm-guard";
import {
  b64uEncodeSync,
  b64uDecodeSync,
  base32Grouped,
  base32ParseGrouped,
  sha256Hex,
} from "../crypto/encoding";
import { SyncApiClient, type DeviceCredentials } from "../sync/client";

export interface PairingTicketPayload {
  ticket: string; // Base64url raw 32 bytes
  ticketHash: string; // SHA-256 hex
  manualCode: string; // Grouped Base32 code XXXX-XXXX-XXXX-...
  qrJson: string; // Serialized JSON payload for QR code
  expiresAt: string;
}

export async function createPairingTicketFlow(args: {
  vaultId: string;
  apiOrigin: string;
  client: SyncApiClient;
  credentials: DeviceCredentials;
}): Promise<PairingTicketPayload> {
  const sodium = await ensureSodium();
  const rawSecret = sodium.randombytes_buf(32);
  const ticketB64u = b64uEncodeSync(sodium, rawSecret);
  const hash = await sha256Hex(rawSecret);
  const manualCode = base32Grouped(rawSecret);

  const response = await args.client.createPairingTicket(hash, args.credentials);

  const qrData = {
    vault_id: args.vaultId,
    api_origin: args.apiOrigin,
    ticket: ticketB64u,
  };

  return {
    ticket: ticketB64u,
    ticketHash: hash,
    manualCode,
    qrJson: JSON.stringify(qrData),
    expiresAt: response.expires_at,
  };
}

export function parsePairingInput(input: string): {
  vaultId?: string;
  apiOrigin?: string;
  ticketB64u: string;
} {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.ticket === "string") {
        return {
          vaultId: parsed.vault_id,
          apiOrigin: parsed.api_origin,
          ticketB64u: parsed.ticket,
        };
      }
    } catch {
      // not JSON, fall through to manual code
    }
  }

  // Treat as manual Base32 code
  const bytes = base32ParseGrouped(trimmed);
  // Encode as base64url without sodium by standard btoa
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return { ticketB64u: b64 };
}
