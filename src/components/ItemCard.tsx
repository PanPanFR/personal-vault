import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import type { ItemWithId, ItemType } from "../lib/types";

const TYPE_COLORS: Record<ItemType, string> = {
  link: "#1e66f5",
  note: "#8839ef",
  snippet: "#7287fd",
  credential: "#40a02b",
};

export function ItemCard({
  item,
  mode = "card",
  onOpen,
}: {
  item: ItemWithId;
  mode?: "list" | "card";
  onOpen: (id: string) => void;
}) {
  const subtitle =
    item.type === "link"
      ? item.url
      : item.type === "note"
        ? item.body?.slice(0, 80)
        : item.type === "snippet"
          ? item.content?.slice(0, 80)
          : (item.username ?? "");

  return (
    <Card className={mode === "list" ? "p-4" : ""}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="flex-1 text-left"
          aria-label={`${item.type}: ${item.title}`}
        >
          <div className="flex items-center gap-2">
            <Badge color={TYPE_COLORS[item.type]}>{item.type}</Badge>
            {item.is_favorite && (
              <span aria-label="favorite">★</span>
            )}
            <h4 className="font-medium">{item.title}</h4>
          </div>
          {subtitle && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-muted)]">
              {subtitle}
            </p>
          )}
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--ctp-surface0)] px-2 py-0.5 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </button>
      </div>
    </Card>
  );
}
