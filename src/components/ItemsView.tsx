import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { QuickAdd } from "./QuickAdd";
import { ItemGrid } from "./ItemGrid";
import { TagChip } from "./TagChip";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/Button";
import { t, I18N } from "../i18n";
import type { ItemType } from "../lib/types";

interface Props {
  title: string;
  /** Restrict to one item type. */
  type?: ItemType;
  /** Show archived items instead of live ones. */
  archived?: boolean;
  /** Only items marked as favourite. */
  favoritesOnly?: boolean;
  showQuickAdd?: boolean;
}

export function ItemsView({
  title,
  type,
  archived = false,
  favoritesOnly = false,
  showQuickAdd = true,
}: Props) {
  const { items } = useItems();
  const { tags } = useTags();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"card" | "list">("card");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    let result = items;
    if (!archived) result = result.filter((item) => !item.is_archived);
    if (favoritesOnly) result = result.filter((item) => item.is_favorite);
    if (type) result = result.filter((item) => item.type === type);
    if (tagFilter) result = result.filter((item) => item.tags.includes(tagFilter));
    return result;
  }, [items, archived, favoritesOnly, type, tagFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <Button
            variant={mode === "card" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setMode("card")}
          >
            {t(I18N.VIEW_CARD)}
          </Button>
          <Button
            variant={mode === "list" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setMode("list")}
          >
            {t(I18N.VIEW_LIST)}
          </Button>
        </div>
      </div>

      {showQuickAdd && <QuickAdd />}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <TagChip
              key={tag.name}
              name={tag.name}
              active={tagFilter === tag.name}
              onClick={() => setTagFilter(tagFilter === tag.name ? null : tag.name)}
            />
          ))}
        </div>
      )}

      {visibleItems.length === 0 ? (
        <EmptyState title={t(I18N.EMPTY_STATE)} />
      ) : (
        <ItemGrid
          items={visibleItems}
          mode={mode}
          onOpen={(id) => navigate(`/items/${id}`)}
        />
      )}
    </div>
  );
}
