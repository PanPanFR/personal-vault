import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};

/** Git short SHA when available; keeps Settings > About honest per build. */
function gitSha(): string {
  try {
    const head = readFileSync(resolve(__dirname, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref:") ? head.slice(4).trim() : null;
    if (ref) {
      try {
        return readFileSync(resolve(__dirname, ".git", ref), "utf8").trim().slice(0, 8);
      } catch {
        return ref.replace(/^refs\/heads\//, "").slice(0, 8);
      }
    }
    return head.slice(0, 8);
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${gitSha()}`),
  },
  server: {
    // Local dev loop: `pnpm dev` (UI) + `pnpm dev:api` (wrangler dev on :8787
    // serving static assets from dist/ plus functions/). UI requests to /api
    // hit the Worker.
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    // Same-origin only. No CDN, no remote runtime dependency.
    assetsInlineLimit: 0,
    target: "es2022",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
});