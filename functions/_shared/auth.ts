import { errorResponse } from "./http";
import { sha256Hex, verifyEd25519 } from "./crypto";

export interface PvDeviceHeader {
  deviceId: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export function parsePvDeviceHeader(header: string | null): PvDeviceHeader | null {
  if (!header) return null;
  const match = (field: string) => {
    const r = new RegExp(`${field}="([^"]*)"`);
    const m = header.match(r);
    return m ? m[1] : null;
  };

  const deviceId = match("device_id");
  const timestamp = match("timestamp");
  const nonce = match("nonce");
  const signature = match("signature");

  if (!deviceId || !timestamp || !nonce || !signature) {
    return null;
  }

  return { deviceId, timestamp, nonce, signature };
}

export interface AuthenticatedDevice {
  deviceId: string;
  vaultId: string;
  publicKey: string;
  label: string;
}

export type AuthResult =
  | { ok: true; device: AuthenticatedDevice }
  | { ok: false; response: Response };

export async function authenticate(
  request: Request,
  env: any,
  options: {
    requireSignature: boolean;
    path: string;
    method: string;
    bodyText?: string;
    expectedVaultId?: string;
  },
): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      response: errorResponse(
        "DEVICE_UNAUTHORIZED",
        "Missing or malformed device bearer token.",
        401,
        false,
      ),
    };
  }

  const rawToken = match[1].trim();
  const tokenHash = await sha256Hex(rawToken);

  let row: any;
  try {
    row = await env.DB.prepare(
      `SELECT vault_id, device_id, public_key, label, revoked_at
       FROM authorized_devices
       WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .first();
  } catch {
    return {
      ok: false,
      response: errorResponse("INTERNAL_ERROR", "Database error.", 500, true),
    };
  }

  if (!row) {
    return {
      ok: false,
      response: errorResponse(
        "DEVICE_UNAUTHORIZED",
        "Unknown or invalid device bearer token.",
        401,
        false,
      ),
    };
  }

  if (row.revoked_at !== null) {
    return {
      ok: false,
      response: errorResponse(
        "DEVICE_REVOKED",
        "The authenticated device has been revoked.",
        401,
        false,
      ),
    };
  }

  const vaultId = row.vault_id as string;
  const deviceId = row.device_id as string;

  if (options.expectedVaultId && options.expectedVaultId !== vaultId) {
    // Oracle defense: 404 on vault mismatch
    return {
      ok: false,
      response: errorResponse(
        "VAULT_NOT_FOUND",
        "The specified vault does not exist.",
        404,
        false,
      ),
    };
  }

  const bodyText = options.bodyText ?? "";
  const bodyDigest = await sha256Hex(bodyText);

  if (options.requireSignature) {
    const pv = parsePvDeviceHeader(request.headers.get("PV-Device"));
    if (!pv) {
      return {
        ok: false,
        response: errorResponse(
          "INVALID_SIGNATURE",
          "Missing or malformed PV-Device header.",
          401,
          false,
        ),
      };
    }

    if (pv.deviceId !== deviceId) {
      return {
        ok: false,
        response: errorResponse(
          "DEVICE_UNAUTHORIZED",
          "Device identity mismatch between Bearer and PV-Device header.",
          401,
          false,
        ),
      };
    }

    const ts = new Date(pv.timestamp).getTime();
    if (!Number.isFinite(ts)) {
      return {
        ok: false,
        response: errorResponse(
          "INVALID_SIGNATURE",
          "Invalid timestamp in PV-Device header.",
          401,
          false,
        ),
      };
    }

    const skewMs = Math.abs(Date.now() - ts);
    if (skewMs > 5 * 60 * 1000) {
      return {
        ok: false,
        response: errorResponse(
          "STALE_TIMESTAMP",
          "Request timestamp differs from server clock by more than 5 minutes.",
          401,
          true,
        ),
      };
    }

    // Cryptographic verification FIRST. Recording the nonce before proving
    // possession of the private key would let any caller with a bare token
    // write rows into request_nonces (storage-exhaustion vector) and would
    // leak a pre-signature replay oracle.
    // Canonical string to sign:
    // HTTP_METHOD\nHTTP_PATH\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX
    const canonical = `${options.method.toUpperCase()}\n${options.path}\n${pv.timestamp}\n${pv.nonce}\n${bodyDigest}`;
    const valid = await verifyEd25519(
      row.public_key,
      new TextEncoder().encode(canonical),
      pv.signature,
    );

    if (!valid) {
      return {
        ok: false,
        response: errorResponse(
          "INVALID_SIGNATURE",
          "Ed25519 signature verification failed.",
          401,
          false,
        ),
      };
    }

    // Signature proven — now apply the replay policy (api-spec 2.3 step 5):
    // same nonce + different body => REPLAY_DETECTED; same nonce + identical
    // body is an idempotent replay of a request we already accepted, so it is
    // rejected rather than re-executed (the cached-response contract is served
    // per-endpoint by idempotency_keys for /sync/batch).
    try {
      const existing = await env.DB.prepare(
        `SELECT body_digest FROM request_nonces WHERE device_id = ? AND nonce = ?`,
      )
        .bind(deviceId, pv.nonce)
        .first();

      if (existing) {
        if (existing.body_digest !== bodyDigest) {
          return {
            ok: false,
            response: errorResponse(
              "REPLAY_DETECTED",
              "A reused nonce was submitted with a differing request body.",
              409,
              false,
            ),
          };
        }
        return {
          ok: false,
          response: errorResponse(
            "REPLAY_DETECTED",
            "This request nonce was already used for an identical body.",
            409,
            false,
          ),
        };
      }

      await env.DB.prepare(
        `INSERT INTO request_nonces (device_id, nonce, body_digest, created_at)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(deviceId, pv.nonce, bodyDigest, Date.now())
        .run();
    } catch {
      // ignore insert conflict
    }
  }

  // Update last_used_at (server-recorded provenance)
  try {
    await env.DB.prepare(
      `UPDATE authorized_devices SET last_used_at = ? WHERE vault_id = ? AND device_id = ?`,
    )
      .bind(new Date().toISOString(), vaultId, deviceId)
      .run();
  } catch {
    // best-effort provenance
  }

  return {
    ok: true,
    device: {
      deviceId,
      vaultId,
      publicKey: row.public_key,
      label: row.label,
    },
  };
}
