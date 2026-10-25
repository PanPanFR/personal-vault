// Minimal D1 surface this Worker uses. Kept local so the Worker build stays
// independent of workers-types; `wrangler types` would emit a much larger file.
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
