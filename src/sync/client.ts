import { ensureSodium } from "../crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../crypto/encoding";
import { isErrorEnvelope, type ErrorCode } from "../lib/errors";
import {
  type MutationPayload,
  type SyncPageResponse,
  type SyncBatchResponse,
} from "./types";

export interface DeviceCredentials {
  deviceId: string;
  rawToken: Uint8Array;
  privateKey: Uint8Array; // Ed25519 private key (64 bytes in libsodium)
}

export class ApiError extends Error {
  code: ErrorCode | string;
  httpStatus: number;
  retryable: boolean;
  retryAfter?: number;
  data?: any;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
    retryAfter?: number,
    data?: any,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = status;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.data = data;
  }
}

export class SyncApiClient {
  private apiOrigin: string;
  private customFetch?: typeof fetch;
  private serverOffsetMs = 0;

  constructor(apiOrigin = "", customFetch?: typeof fetch) {
    this.apiOrigin = apiOrigin.replace(/\/+$/, "");
    this.customFetch = customFetch;
  }

  private get fetchFn(): typeof fetch {
    return this.customFetch ?? fetch;
  }

  public getCalibratedNow(): Date {
    return new Date(Date.now() + this.serverOffsetMs);
  }

  private updateServerTime(headers: Headers): void {
    const serverTimeStr = headers.get("X-Server-Time");
    if (serverTimeStr) {
      const serverTimeMs = new Date(serverTimeStr).getTime();
      if (Number.isFinite(serverTimeMs)) {
        this.serverOffsetMs = serverTimeMs - Date.now();
      }
    }
  }

  public async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: any;
      credentials?: DeviceCredentials;
      requireSignature?: boolean;
    } = {},
  ): Promise<T> {
    const method = options.method ?? (options.body ? "POST" : "GET");
    const url = `${this.apiOrigin}${path}`;
    const headers = new Headers();

    let rawBody = "";
    if (options.body !== undefined) {
      rawBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      headers.set("Content-Type", "application/json; charset=utf-8");
    }

    if (options.credentials) {
      const sodium = await ensureSodium();
      const tokenB64u = b64uEncodeSync(sodium, options.credentials.rawToken);
      headers.set("Authorization", `Bearer ${tokenB64u}`);

      if (options.requireSignature) {
        const timestamp = this.getCalibratedNow().toISOString();
        const nonce = crypto.randomUUID();
        const bodyDigest = await sha256Hex(new Uint8Array(new TextEncoder().encode(rawBody)));

        // Canonical string: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX
        const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyDigest}`;
        const sigBytes = sodium.crypto_sign_detached(
          new Uint8Array(new TextEncoder().encode(canonical)),
          new Uint8Array(options.credentials.privateKey),
        );
        const sigB64u = b64uEncodeSync(sodium, sigBytes);

        headers.set(
          "PV-Device",
          `device_id="${options.credentials.deviceId}", timestamp="${timestamp}", nonce="${nonce}", signature="${sigB64u}"`,
        );
      }
    }

    const res = await this.fetchFn(url, {
      method,
      headers,
      body: rawBody ? rawBody : undefined,
    });

    this.updateServerTime(res.headers);

    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;

    let jsonBody: any = null;
    const text = await res.text();
    if (text) {
      try {
        jsonBody = JSON.parse(text);
      } catch {
        jsonBody = { message: text };
      }
    }

    if (!res.ok) {
      // Clock-skew auto-retry: exactly ONCE, per api-spec 3.2 / sync-protocol 8.2
      // ("re-syncs clock via X-Server-Time and retries once"). Without a retry
      // cap a persistent skew would recurse forever.
      if (
        jsonBody?.code === "STALE_TIMESTAMP" &&
        options.requireSignature &&
        !(options as any)._retriedSkew
      ) {
        return this.request(path, { ...options, _retriedSkew: true } as any);
      }

      const code = jsonBody?.code ?? `HTTP_${res.status}`;
      const message = jsonBody?.message ?? res.statusText ?? "Request failed";
      const retryable = jsonBody?.retryable ?? (res.status === 429 || res.status >= 500);

      throw new ApiError(code, message, res.status, retryable, retryAfter, jsonBody);
    }

    return jsonBody as T;
  }

  // Endpoint helpers
  public async createVault(payload: any): Promise<any> {
    return this.request("/api/v1/vaults", {
      method: "POST",
      body: payload,
    });
  }

  public async getBootstrap(
    vaultId: string,
    credentials: DeviceCredentials,
  ): Promise<any> {
    return this.request(`/api/v1/vaults/${vaultId}/bootstrap`, {
      method: "GET",
      credentials,
      requireSignature: false,
    });
  }

  public async getSync(
    cursor: number,
    limit: number,
    credentials: DeviceCredentials,
  ): Promise<SyncPageResponse> {
    return this.request(`/api/v1/sync?cursor=${cursor}&limit=${limit}`, {
      method: "GET",
      credentials,
      requireSignature: false,
    });
  }

  public async postSyncBatch(
    mutations: MutationPayload[],
    credentials: DeviceCredentials,
  ): Promise<SyncBatchResponse> {
    return this.request("/api/v1/sync/batch", {
      method: "POST",
      body: { mutations },
      credentials,
      requireSignature: true,
    });
  }

  public async createPairingTicket(
    ticketHash: string,
    credentials: DeviceCredentials,
  ): Promise<{ ticket_id: string; expires_at: string }> {
    return this.request("/api/v1/pairing-tickets", {
      method: "POST",
      body: { ticket_hash: ticketHash },
      credentials,
      requireSignature: true,
    });
  }

  public async exchangePairingTicket(payload: {
    vault_id: string;
    ticket: string;
    device_id: string;
    device_public_key: string;
    label?: string;
  }): Promise<{
    vault_id: string;
    device_id: string;
    device_token: string;
    created_at: string;
  }> {
    return this.request("/api/v1/pairing/exchange", {
      method: "POST",
      body: payload,
    });
  }

  public async revokeDevice(
    targetDeviceId: string,
    credentials: DeviceCredentials,
  ): Promise<{ device_id: string; revoked_at: string; status: string }> {
    return this.request(`/api/v1/devices/${targetDeviceId}/revoke`, {
      method: "POST",
      body: {},
      credentials,
      requireSignature: true,
    });
  }

  public async updateCryptoMetadata(
    payload: any,
    credentials: DeviceCredentials,
  ): Promise<any> {
    return this.request("/api/v1/vault/crypto-metadata", {
      method: "PUT",
      body: payload,
      credentials,
      requireSignature: true,
    });
  }

  public async recoveryEnrollDevice(payload: {
    vault_id: string;
    recovery_auth_token: string;
    device_id: string;
    device_public_key: string;
    label?: string;
  }): Promise<{
    vault_id: string;
    device_id: string;
    device_token: string;
    recovery_envelope: any;
    created_at: string;
  }> {
    return this.request("/api/v1/recovery/enroll-device", {
      method: "POST",
      body: payload,
    });
  }
}
