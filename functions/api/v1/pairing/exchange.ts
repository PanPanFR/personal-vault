import { json, errorResponse, readJsonBody, type PagesFunction } from "../../../_shared/http";
import { checkRateLimit, rateLimitedResponse } from "../../../_shared/rate-limit";
import {
  sha256Hex,
  randomTokenBase64Url,
  isVaultId,
  isUuidV4,
  base64UrlDecode,
} from "../../../_shared/crypto";

export const onRequestPost: PagesFunction<any> = async (context) => {
  const parsed = await readJsonBody(context.request);
  if (!parsed.ok) return parsed.response;
  const body: any = parsed.value;

  if (!body || typeof body !== "object") {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
      400,
      false,
    );
  }

  if (!isVaultId(body.vault_id)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "vault_id must be a 26-character ULID string.",
      400,
      false,
    );
  }

  if (typeof body.ticket !== "string" || body.ticket.length === 0) {
    return errorResponse(
      "VALIDATION_ERROR",
      "ticket must be a non-empty string.",
      400,
      false,
    );
  }

  if (!isUuidV4(body.device_id)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device_id must be a valid UUIDv4.",
      400,
      false,
    );
  }

  if (
    typeof body.device_public_key !== "string" ||
    body.device_public_key.length === 0
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device_public_key must be a non-empty base64url string.",
      400,
      false,
    );
  }

  const vaultId = body.vault_id;

  // Rate limit: 10 requests per vault per hour
  const rl = await checkRateLimit(
    context.env,
    "pairing-exchange",
    vaultId,
    10,
    3600,
  );
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  try {
    // Vault existence must NOT be distinguishable from "wrong ticket" on this
    // unauthenticated route: an attacker holding only a vault_id would
    // otherwise learn which ULIDs are real. Unknown vault and unknown ticket
    // both answer TICKET_INVALID (api-spec 3.2 uniform-oracle rule).
    const vault: any = await context.env.DB.prepare(
      `SELECT vault_id FROM vaults WHERE vault_id = ?`,
    )
      .bind(vaultId)
      .first();

    if (!vault) {
      return errorResponse(
        "TICKET_INVALID",
        "Pairing ticket hash is unknown, invalid, or does not belong to the specified vault.",
        400,
        false,
      );
    }

    let ticketBytes: Uint8Array;
    try {
      ticketBytes = base64UrlDecode(body.ticket);
      if (ticketBytes.length !== 32) {
        ticketBytes = new TextEncoder().encode(body.ticket);
      }
    } catch {
      ticketBytes = new TextEncoder().encode(body.ticket);
    }

    const ticketHash = await sha256Hex(ticketBytes);
    const ticketRow: any = await context.env.DB.prepare(
      `SELECT ticket_hash, vault_id, expires_at, consumed_at
       FROM pairing_tickets
       WHERE ticket_hash = ?`,
    )
      .bind(ticketHash)
      .first();

    if (!ticketRow || ticketRow.vault_id !== vaultId) {
      return errorResponse(
        "TICKET_INVALID",
        "Pairing ticket hash is unknown, invalid, or does not belong to the specified vault.",
        400,
        false,
      );
    }

    const now = Date.now();
    const expiryTime = new Date(ticketRow.expires_at).getTime();

    if (now > expiryTime) {
      return errorResponse(
        "TICKET_EXPIRED",
        "Pairing ticket is past its 5-minute lifespan.",
        410,
        false,
      );
    }

    if (ticketRow.consumed_at !== null) {
      return errorResponse(
        "TICKET_CONSUMED",
        "Pairing ticket has already been exchanged or superseded.",
        410,
        false,
      );
    }

    // Generate device bearer token server-side (returned ONCE)
    const rawToken = randomTokenBase64Url(32);
    const tokenHash = await sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim()
        : `Device-${body.device_id.slice(0, 4).toUpperCase()}`;

    // Atomically consume ticket and register device.
    // The consume is a CONDITIONAL update: `AND consumed_at IS NULL` makes the
    // claim a single atomic compare-and-set. Two concurrent exchanges both read
    // consumed_at = NULL above, but only the one whose UPDATE reports a changed
    // row may proceed — the loser gets TICKET_CONSUMED (api-spec 6.6 "Atomic
    // Single-Use Invariant"). The device INSERT is skipped for the loser so no
    // second device is ever enrolled from one ticket.
    let claimed: { changes?: number } | null = null;
    let inserted: { changes?: number } | null = null;
    try {
      [claimed, inserted] = await context.env.DB.batch([
        context.env.DB.prepare(
          `UPDATE pairing_tickets
           SET consumed_at = ?
           WHERE ticket_hash = ? AND consumed_at IS NULL`,
        ).bind(nowIso, ticketHash),
        context.env.DB.prepare(
          `INSERT INTO authorized_devices (
            vault_id, device_id, token_hash, public_key, label, created_at, last_used_at, revoked_at, last_ack_cursor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        ).bind(
          vaultId,
          body.device_id,
          tokenHash,
          body.device_public_key,
          label,
          nowIso,
          nowIso,
        ),
      ]);
    } catch (err: any) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes("unique")) {
        // device_id already registered for this vault
        return errorResponse(
          "VALIDATION_ERROR",
          "Device is already registered for this vault.",
          400,
          false,
        );
      }
      throw err;
    }

    const affected = claimed?.changes ?? 1;
    if (affected !== 1) {
      return errorResponse(
        "TICKET_CONSUMED",
        "Pairing ticket has already been exchanged or superseded.",
        410,
        false,
      );
    }
    void inserted;

    return json(
      {
        vault_id: vaultId,
        device_id: body.device_id,
        device_token: rawToken,
        created_at: nowIso,
      },
      201,
    );
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "Pairing exchange failed in database.",
      500,
      true,
    );
  }
};
