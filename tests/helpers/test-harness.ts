import { createMockD1, type D1Database } from "./mock-d1";
import { onRequestPost as handleVaultsPost } from "../../functions/api/v1/vaults";
import { onRequestGet as handleBootstrapGet } from "../../functions/api/v1/vaults/[vaultId]/bootstrap";
import { onRequestGet as handleSyncGet } from "../../functions/api/v1/sync";
import { onRequestPost as handleSyncBatchPost } from "../../functions/api/v1/sync/batch";
import { onRequestPost as handlePairingTicketsPost } from "../../functions/api/v1/pairing-tickets";
import { onRequestPost as handlePairingExchangePost } from "../../functions/api/v1/pairing/exchange";
import { onRequestPost as handleDeviceRevokePost } from "../../functions/api/v1/devices/[deviceId]/revoke";
import { onRequestPut as handleCryptoMetadataPut } from "../../functions/api/v1/vault/crypto-metadata";
import { onRequestPost as handleRecoveryEnrollPost } from "../../functions/api/v1/recovery/enroll-device";

export class TestServer {
  public db: D1Database;

  constructor() {
    this.db = createMockD1();
  }

  public async fetch(urlStr: string, init?: RequestInit): Promise<Response> {
    const url = new URL(urlStr, "https://personal-vault.pages.dev");
    const pathname = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    const request = new Request(url.toString(), init);
    const env = { DB: this.db };

    // Route matching
    if (pathname === "/api/v1/vaults" && method === "POST") {
      return handleVaultsPost({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    const bootstrapMatch = pathname.match(/^\/api\/v1\/vaults\/([^/]+)\/bootstrap$/);
    if (bootstrapMatch && method === "GET") {
      return handleBootstrapGet({ request, env, params: { vaultId: bootstrapMatch[1] }, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/sync" && method === "GET") {
      return handleSyncGet({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/sync/batch" && method === "POST") {
      return handleSyncBatchPost({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/pairing-tickets" && method === "POST") {
      return handlePairingTicketsPost({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/pairing/exchange" && method === "POST") {
      return handlePairingExchangePost({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    const revokeMatch = pathname.match(/^\/api\/v1\/devices\/([^/]+)\/revoke$/);
    if (revokeMatch && method === "POST") {
      return handleDeviceRevokePost({ request, env, params: { deviceId: revokeMatch[1] }, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/vault/crypto-metadata" && method === "PUT") {
      return handleCryptoMetadataPut({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    if (pathname === "/api/v1/recovery/enroll-device" && method === "POST") {
      return handleRecoveryEnrollPost({ request, env, params: {}, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) } as any);
    }

    return new Response(JSON.stringify({ code: "NOT_FOUND", message: "Not found", retryable: false }), { status: 404 });
  }

  public close(): void {
    this.db.close();
  }
}
