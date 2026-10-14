import { useCallback, useEffect, useState } from "react";
import { useItems } from "./useItems";

export function useTags() {
  const { items } = useItems();
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      for (const t of it.tags) map.set(t, (map.get(t) ?? 0) + 1);
    }
    setTags(Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  }, [items]);

  return { tags };
}
