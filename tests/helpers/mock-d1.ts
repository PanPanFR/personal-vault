import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const req = createRequire(import.meta.url);
const { DatabaseSync } = req("node:sqlite");

export interface D1PreparedStatement {
  bind(...args: any[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta: any }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(query: string): Promise<void>;
  close(): void;
}

export function createMockD1(): D1Database {
  const db = new DatabaseSync(":memory:");

  // Execute migrations
  const m1 = fs.readFileSync(
    path.join(process.cwd(), "migrations", "0001_init.sql"),
    "utf-8",
  );
  db.exec(m1);

  if (fs.existsSync(path.join(process.cwd(), "migrations", "0002_rate_and_idempotency.sql"))) {
    const m2 = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0002_rate_and_idempotency.sql"),
      "utf-8",
    );
    db.exec(m2);
  }

  function createStatement(sql: string, boundArgs: any[] = []): D1PreparedStatement {
    return {
      bind(...args: any[]) {
        return createStatement(sql, args);
      },
      async first<T = unknown>() {
        const stmt = db.prepare(sql);
        // node:sqlite .get takes args directly
        const row = stmt.get(...boundArgs);
        return (row as T) ?? null;
      },
      async all<T = unknown>() {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...boundArgs);
        return { results: rows as T[], success: true };
      },
      async run() {
        const stmt = db.prepare(sql);
        const res = stmt.run(...boundArgs);
        return { success: true, meta: res };
      },
    };
  }

  return {
    prepare(query: string) {
      return createStatement(query);
    },
    async batch(statements: D1PreparedStatement[]) {
      db.exec("BEGIN TRANSACTION");
      try {
        const results = [];
        for (const s of statements) {
          results.push(await s.run());
        }
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(query: string) {
      db.exec(query);
    },
    close() {
      db.close();
    },
  };
}
