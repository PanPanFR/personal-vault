import { useCallback, useRef, useState } from "react";
import { runSearch } from "../lib/search";
import type { ItemWithId } from "../lib/types";

export type SearchFn = (query: string) => ItemWithId[];

/**
 * Search hook for the Ctrl+K overlay. Defaults to the fixture filter in
 * src/lib/search.ts; the crypto plan injects its MiniSearch implementation
 * via setSearchFn (same `(query) => Item[]` signature, no other changes).
 */
export function useSearch(items: ItemWithId[]) {
  const customFn = useRef<SearchFn | null>(null);
  const [query, setQuery] = useState("");

  const setSearchFn = useCallback((fn: SearchFn | null) => {
    customFn.current = fn;
  }, []);

  const results: ItemWithId[] =
    customFn.current?.(query) ?? runSearch(items, query);

  return { query, setQuery, results, setSearchFn };
}
