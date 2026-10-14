import React, { useState } from "react";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { useNavigate } from "react-router-dom";
import { QuickAdd } from "./QuickAdd";
import { ItemCard } from "./ItemCard";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/Button";
import { t, I18N } from "../i18n";
import type { ItemWithId } from "../lib/types";

export function ItemsView({ title, filter, showQuickAdd = true }: { title: string; filter: (i: ItemWithId) => boolean; showQuickAdd?: boolean }) {
  const { items } = useItems();
  const { tags } = useTags();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"card" | "list">("card");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  let viewItems = items.filter(filter);
  if (tagFilter) viewItems = viewItems.filter((i) => i.tags.includes(tagFilter));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <Button variant={mode === "card" ? "primary" : "secondary"} size="sm" onClick={() => setMode("card")}>{t(I18N.VIEW_CARD)}</Button>
          <Button variant={mode === "list" ? "primary" : "secondary"} size="sm" onClick={() => setMode("list")}>{t(I18N.VIEW_LIST)}</Button>
        </div>
      </div>

      {showQuickAdd && <QuickAdd />}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => setTagFilter(tagFilter === tag.name ? null : tag.name)}
              className={`rounded-full px-3 py-1 text-xs ${tagFilter === tag.name ? "bg-[var(--color-primary)] text-white" : "bg-[var(--ctp-surface0)]"}`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {viewItems.length === 0 ? (
        <EmptyState title={t(I18N.EMPTY_STATE)} />
      ) : (
        <div className={mode === "card" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>
          {viewItems.map((it) => (
            <ItemCard key={it.id} item={it} mode={mode} onOpen={(id) => navigate(`/items/${id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}