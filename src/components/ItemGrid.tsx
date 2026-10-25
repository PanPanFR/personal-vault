import { ItemCard } from "./ItemCard";
import type { ItemWithId } from "../lib/types";

interface Props {
  items: ItemWithId[];
  mode?: "card" | "list";
  onOpen: (id: string) => void;
}

/** Grid of item cards - the one list rendering shared by every page. */
export function ItemGrid({ items, mode = "card", onOpen }: Props) {
  const layout =
    mode === "card" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2";

  return (
    <div className={layout}>
      {items.map((item) => (
        <ItemCard key={item.id} item={item} mode={mode} onOpen={onOpen} />
      ))}
    </div>
  );
}
