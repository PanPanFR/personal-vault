import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { ItemCard } from "../components/ItemCard";
import { EmptyState } from "../components/EmptyState";
import { Card } from "../components/ui/Card";
import { I18N, t } from "../i18n";

export default function Tags() {
  const { items } = useItems();
  const { tags } = useTags();
  const navigate = useNavigate();
  const { tag: routeTag } = useParams();
  const [active, setActive] = useState<string | null>(routeTag ?? null);
  const selected = routeTag ?? active;

  const filtered = selected
    ? items.filter((i) => i.tags.includes(selected) && !i.is_archived)
    : [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t(I18N.TAGS)}</h1>
      {tags.length === 0 ? (
        <EmptyState title={t(I18N.EMPTY_STATE)} description="Tags appear here once you add them to items." />
      ) : (
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => {
                  setActive(tag.name);
                  navigate(`/tags/${encodeURIComponent(tag.name)}`);
                }}
                aria-pressed={selected === tag.name}
                className={`rounded-full px-3 py-1 text-xs ${
                  selected === tag.name
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--ctp-surface0)]"
                }`}
              >
                {tag.name} ({tag.count})
              </button>
            ))}
          </div>
        </Card>
      )}
      {selected && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">#{selected}</h2>
          {filtered.length === 0 ? (
            <EmptyState title={t(I18N.EMPTY_STATE)} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((it) => (
                <ItemCard key={it.id} item={it} onOpen={(id) => navigate(`/items/${id}`)} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
