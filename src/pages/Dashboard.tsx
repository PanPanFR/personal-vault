import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { Card } from "../components/ui/Card";
import { QuickAdd } from "../components/QuickAdd";
import { SyncStatusPlaceholder } from "../components/SyncStatusPlaceholder";
import { EmptyState } from "../components/EmptyState";
import { ItemCard } from "../components/ItemCard";
import { I18N, t } from "../i18n";

export default function Dashboard() {
  const { items } = useItems();
  const { tags } = useTags();
  const navigate = useNavigate();
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = activeTag ? items.filter((i) => i.tags.includes(activeTag) && !i.is_archived) : items.filter((i) => !i.is_archived);
  const recent = filtered.slice(0, 6);
  const favorites = items.filter((i) => i.is_favorite && !i.is_archived).slice(0, 5);

  const categories = [
    { label: t(I18N.LINKS), to: "/links", count: items.filter((i) => i.type === "link").length },
    { label: t(I18N.NOTES), to: "/notes", count: items.filter((i) => i.type === "note").length },
    { label: t(I18N.SNIPPETS), to: "/snippets", count: items.filter((i) => i.type === "snippet").length },
    { label: t(I18N.CREDENTIALS), to: "/credentials", count: items.filter((i) => i.type === "credential").length },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t(I18N.DASHBOARD_TITLE)}</h1>
      <SyncStatusPlaceholder />
      <QuickAdd />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <Card key={c.to} className="p-4">
            <button type="button" className="w-full text-left" onClick={() => navigate(c.to)}>
              <div className="text-lg font-semibold">{c.label}</div>
              <div className="text-sm text-[var(--color-muted)]">{c.count} items</div>
            </button>
          </Card>
        ))}
      </div>

      {tags.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">{t(I18N.TAG_FILTERS)}</h2>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => setActiveTag(activeTag === tag.name ? null : tag.name)}
                className={`rounded-full px-3 py-1 text-xs ${activeTag === tag.name ? "bg-[var(--color-primary)] text-white" : "bg-[var(--ctp-surface0)]"}`}
              >
                {tag.name} ({tag.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {favorites.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">{t(I18N.FAVORITES)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((it) => <ItemCard key={it.id} item={it} onOpen={(id) => navigate(`/items/${id}`)} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t(I18N.RECENT_ITEMS)}</h2>
        {recent.length === 0 ? (
          <EmptyState title={t(I18N.EMPTY_STATE)} description="Use Quick Add to create your first item." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((it) => <ItemCard key={it.id} item={it} onOpen={(id) => navigate(`/items/${id}`)} />)}
          </div>
        )}
      </section>
    </div>
  );
}