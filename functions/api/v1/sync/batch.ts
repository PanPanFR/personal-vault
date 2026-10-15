import { json, errorResponse, bytesLength, type PagesFunction } from "../../../_shared/http";
import { authenticate } from "../../../_shared/auth";
import { checkRateLimit, rateLimitedResponse } from "../../../_shared/rate-limit";
import { isUuidV4, sha256Hex } from "../../../_shared/crypto";

const CIPHERTEXT_RECORD_CAP_BYTES = 384 * 1024;
const SYNC_BATCH_MAX_MUTATIONS = 50;
const SYNC_BATCH_MAX_BYTES = 1 * 1024 * 1024;

/**
 * Key-order-independent serialization for idempotency digests. A semantically
 * identical mutation with reordered JSON keys must hash the same, otherwise a
 * legitimate retry would be misreported as REPLAY_DETECTED.
 */
function canonicalMutationJson(m: any): string {
  const keys = Object.keys(m).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = m[k];
  return JSON.stringify(out);
}

export const onRequestPost: PagesFunction<any> = async (context) => {
  const url = new URL(context.request.url);
  const rawBody = await context.request.text();

  if (bytesLength(rawBody) > SYNC_BATCH_MAX_BYTES) {
    return errorResponse(
      "PAYLOAD_TOO_LARGE",
      "Total batch body exceeds 1 MiB limit.",
      413,
      false,
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body is not valid JSON.",
      400,
      false,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray(body.mutations) ||
    body.mutations.length === 0
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "mutations must be a non-empty array.",
      400,
      false,
    );
  }

  if (body.mutations.length > SYNC_BATCH_MAX_MUTATIONS) {
    return errorResponse(
      "PAYLOAD_TOO_LARGE",
      "Batch exceeds 50 mutations limit.",
      413,
      false,
    );
  }

  for (const m of body.mutations) {
    if (!m || typeof m !== "object") {
      return errorResponse("VALIDATION_ERROR", "Mutation must be an object.", 400, false);
    }
    if (!isUuidV4(m.mutation_id) || !isUuidV4(m.record_id)) {
      return errorResponse("VALIDATION_ERROR", "mutation_id and record_id must be UUIDv4.", 400, false);
    }
    if (!Number.isInteger(m.expected_revision) || m.expected_revision < 0) {
      return errorResponse("VALIDATION_ERROR", "expected_revision must be an integer >= 0.", 400, false);
    }
    if (typeof m.is_tombstone !== "boolean") {
      return errorResponse("VALIDATION_ERROR", "is_tombstone must be a boolean.", 400, false);
    }
    if (!Number.isInteger(m.schema_version) || m.schema_version < 1) {
      return errorResponse("VALIDATION_ERROR", "schema_version must be an integer >= 1.", 400, false);
    }
    if (!Number.isInteger(m.key_version) || m.key_version < 1) {
      return errorResponse("VALIDATION_ERROR", "key_version must be an integer >= 1.", 400, false);
    }
    if (m.is_tombstone) {
      // Tombstones carry no payload at all (sync-protocol 3.1).
      if (m.ciphertext != null || m.nonce_b64u != null) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Tombstone mutations must carry null ciphertext and nonce.",
          400,
          false,
        );
      }
    } else {
      // A live record MUST carry ciphertext + nonce; a null-ciphertext live
      // record would violate the SyncChange wire contract.
      if (typeof m.ciphertext !== "string" || m.ciphertext.length === 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Non-tombstone mutations require a non-empty ciphertext.",
          400,
          false,
        );
      }
      if (typeof m.nonce_b64u !== "string" || m.nonce_b64u.length === 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Non-tombstone mutations require a nonce_b64u.",
          400,
          false,
        );
      }
      if (bytesLength(m.ciphertext) > CIPHERTEXT_RECORD_CAP_BYTES) {
        return errorResponse(
          "PAYLOAD_TOO_LARGE",
          "Single record ciphertext exceeds 384 KiB limit.",
          413,
          false,
        );
      }
    }
  }

  const auth = await authenticate(context.request, context.env, {
    requireSignature: true,
    path: url.pathname,
    method: "POST",
    bodyText: rawBody,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const vaultId = auth.device.vaultId;

  // Rate limit: 120 per vault per hour
  const rl = await checkRateLimit(context.env, "sync-push", vaultId, 120, 3600);
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  try {
    // Ensure idempotency_keys table exists
    await context.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        mutation_id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        change_seq INTEGER NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ).run();

    // Check if entire batch is an identical retry (all mutation_ids already committed)
    const existingMutations: Record<string, any> = {};
    for (const m of body.mutations) {
      const row = await context.env.DB.prepare(
        `SELECT mutation_id, record_id, revision, change_seq, payload_digest
         FROM idempotency_keys WHERE mutation_id = ? AND vault_id = ?`,
      )
        .bind(m.mutation_id, vaultId)
        .first();

      if (row) {
        const payloadDigest = await sha256Hex(canonicalMutationJson(m));
        if (row.payload_digest !== payloadDigest) {
          return errorResponse(
            "REPLAY_DETECTED",
            "A reused mutation_id was submitted with a differing payload.",
            409,
            false,
          );
        }
        existingMutations[m.mutation_id] = row;
      }
    }

    if (Object.keys(existingMutations).length === body.mutations.length) {
      // All mutations were previously applied: return cached success response
      const results = body.mutations.map((m: any) => {
        const ex = existingMutations[m.mutation_id];
        return {
          mutation_id: m.mutation_id,
          record_id: m.record_id,
          revision: ex.revision,
          change_seq: ex.change_seq,
          status: "applied",
        };
      });
      const maxCursor = Math.max(...results.map((r: any) => r.change_seq));
      return json({ results, new_cursor: maxCursor }, 200);
    }

    // Read current vault change_seq
    const vaultRow: any = await context.env.DB.prepare(
      `SELECT current_change_seq FROM vaults WHERE vault_id = ?`,
    )
      .bind(vaultId)
      .first();

    if (!vaultRow) {
      return errorResponse("VAULT_NOT_FOUND", "Vault not found.", 404, false);
    }

    let currentSeq = vaultRow.current_change_seq as number;

    // Check CAS revisions for all mutations first (Atomic: fail on any mismatch)
    for (const m of body.mutations) {
      const rec: any = await context.env.DB.prepare(
        `SELECT revision, change_seq, schema_version, key_version, is_deleted, ciphertext, nonce
         FROM vault_records
         WHERE vault_id = ? AND record_id = ?`,
      )
        .bind(vaultId, m.record_id)
        .first();

      const currentRev = rec ? (rec.revision as number) : 0;
      if (m.expected_revision !== currentRev) {
        // Revision conflict!
        return json(
          {
            code: "REVISION_CONFLICT",
            message: "The record was updated on another device. Revision mismatch.",
            retryable: false,
            record_id: m.record_id,
            expected_revision: m.expected_revision,
            server_revision: currentRev,
            server_change_seq: rec ? rec.change_seq : currentSeq,
            server_schema_version: rec ? rec.schema_version : 1,
            server_key_version: rec ? rec.key_version : 1,
            is_tombstone: rec ? rec.is_deleted === 1 : false,
            server_ciphertext: rec && rec.is_deleted === 0 ? rec.ciphertext : null,
            server_nonce_b64u: rec && rec.is_deleted === 0 ? rec.nonce : null,
          },
          409,
        );
      }
    }

    // Apply all mutations in atomic batch
    const statements: any[] = [];
    const results: any[] = [];
    const now = new Date().toISOString();

    for (const m of body.mutations) {
      currentSeq += 1;
      const nextRev = m.expected_revision + 1;
      const isDeleted = m.is_tombstone ? 1 : 0;
      const ciphertext = m.is_tombstone ? null : (m.ciphertext ?? null);
      const nonce = m.is_tombstone ? null : (m.nonce_b64u ?? null);
      const schemaVer = m.schema_version ?? 1;
      const keyVer = m.key_version ?? 1;

      // CAS-guarded write. The revision predicate lives in the WHERE clause so
      // the compare-and-swap is atomic inside the batch transaction: if a
      // concurrent batch already advanced this record, `revision = ?` matches
      // zero rows and the guard check below aborts the whole batch. Without
      // this the earlier read-then-write would be last-writer-wins
      // (api-spec 6.4, sync-protocol 2.1).
      if (nextRev === 1) {
        // Record must not exist yet (create path, expected_revision = 0).
        statements.push(
          context.env.DB.prepare(
            `INSERT INTO vault_records (
              vault_id, record_id, ciphertext, nonce, schema_version,
              key_version, revision, change_seq, is_deleted, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(vault_id, record_id) DO NOTHING`,
          ).bind(
            vaultId,
            m.record_id,
            ciphertext,
            nonce,
            schemaVer,
            keyVer,
            nextRev,
            currentSeq,
            isDeleted,
            now,
          ),
        );
      } else {
        statements.push(
          context.env.DB.prepare(
            `UPDATE vault_records SET
              ciphertext = ?,
              nonce = ?,
              schema_version = ?,
              key_version = ?,
              revision = ?,
              change_seq = ?,
              is_deleted = ?,
              updated_at = ?
             WHERE vault_id = ? AND record_id = ? AND revision = ?`,
          ).bind(
            ciphertext,
            nonce,
            schemaVer,
            keyVer,
            nextRev,
            currentSeq,
            isDeleted,
            now,
            vaultId,
            m.record_id,
            m.expected_revision,
          ),
        );
      }

      // Append sync_changes — gated on the SAME CAS predicate as the record
      // write above, so a lost race inserts nothing instead of orphaning a
      // change-log entry. INSERT OR IGNORE additionally dedupes on the
      // (vault_id, change_seq) primary key when two racers compute the same
      // sequence.
      statements.push(
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO sync_changes (
            vault_id, change_seq, record_id, revision, change_type, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM vault_records
            WHERE vault_id = ? AND record_id = ? AND revision = ? AND change_seq = ?
          )`,
        ).bind(
          vaultId,
          currentSeq,
          m.record_id,
          nextRev,
          m.is_tombstone ? "delete" : "upsert",
          now,
          vaultId,
          m.record_id,
          nextRev,
          currentSeq,
        ),
      );

      // Record idempotency key (canonical digest — key order independent).
      const payloadDigest = await sha256Hex(canonicalMutationJson(m));
      statements.push(
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO idempotency_keys (
            mutation_id, vault_id, record_id, revision, change_seq, payload_digest, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM vault_records
            WHERE vault_id = ? AND record_id = ? AND revision = ? AND change_seq = ?
          )`,
        ).bind(
          m.mutation_id,
          vaultId,
          m.record_id,
          nextRev,
          currentSeq,
          payloadDigest,
          Date.now(),
          vaultId,
          m.record_id,
          nextRev,
          currentSeq,
        ),
      );

      results.push({
        mutation_id: m.mutation_id,
        record_id: m.record_id,
        revision: nextRev,
        change_seq: currentSeq,
        status: "applied",
      });
    }

    // Update vault change_seq
    statements.push(
      context.env.DB.prepare(
        `UPDATE vaults SET current_change_seq = ?, updated_at = ? WHERE vault_id = ?`,
      ).bind(currentSeq, now, vaultId),
    );

    const batchResults = await context.env.DB.batch(statements);

    // CAS guard verification. Each record write is the first statement of its
    // group, so index 3*i is the guarded record write for mutation i. A
    // concurrent batch that advanced the same record first makes the revision
    // predicate match zero rows; the gated dependent statements then inserted
    // nothing, so the committed state is a consistent no-op. Surface it as a
    // 409 REVISION_CONFLICT with the current server state so the client runs
    // its normal conflict-resolution flow instead of assuming success.
    for (let i = 0; i < body.mutations.length; i++) {
      const guard = batchResults[i * 3];
      const changed = guard?.meta?.changes ?? guard?.changes;
      if (typeof changed === "number" && changed === 0) {
        const loser = body.mutations[i];
        const rec: any = await context.env.DB.prepare(
          `SELECT revision, change_seq, schema_version, key_version, is_deleted, ciphertext, nonce
           FROM vault_records
           WHERE vault_id = ? AND record_id = ?`,
        )
          .bind(vaultId, loser.record_id)
          .first();

        return json(
          {
            code: "REVISION_CONFLICT",
            message: "The record was updated on another device. Revision mismatch.",
            retryable: false,
            record_id: loser.record_id,
            expected_revision: loser.expected_revision,
            server_revision: rec ? rec.revision : 0,
            server_change_seq: rec ? rec.change_seq : currentSeq,
            server_schema_version: rec ? rec.schema_version : 1,
            server_key_version: rec ? rec.key_version : 1,
            is_tombstone: rec ? rec.is_deleted === 1 : false,
            server_ciphertext: rec && rec.is_deleted === 0 ? rec.ciphertext : null,
            server_nonce_b64u: rec && rec.is_deleted === 0 ? rec.nonce : null,
          },
          409,
        );
      }
    }

    return json({ results, new_cursor: currentSeq }, 200);
  } catch (err: any) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("quota")) {
      return errorResponse(
        "QUOTA_EXHAUSTED",
        "Cloudflare free-tier quota exhausted. Cloud sync paused.",
        503,
        true,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Database batch write failed.", 500, true);
  }
};
