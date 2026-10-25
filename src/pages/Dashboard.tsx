import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { Card } from "../components/ui/Card";
import { QuickAdd } from "../components/QuickAdd";
import { EmptyState } from "../components/EmptyState";
import { ItemGrid } from "../components/ItemGrid";
import { TagChip } from "../components/TagChip";
import { I18N, t } from "../i18n";
import { InstallPrompt } from "../components/InstallPrompt";

export default function Dashboard() {
  const { items } = useItems();
  const { tags } = useTags();
  const navigate = useNavigate();
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const live = useMemo(() => items.filter((item) => !item.is_archived), [items]);
  const visible = useMemo(
    () => (activeTag ? live.filter((item) => item.tags.includes(activeTag)) : live),
    [live, activeTag],
  );
  const recent = visible.slice(0, 6);
  const favorites = useMemo(
    () => live.filter((item) => item.is_favorite).slice(0, 5),
    [live],
  );

  const categories = [
    { label: t(I18N.LINKS), to: "/links", count: items.filter((i) => i.type === "link").length },
    { label: t(I18N.NOTES), to: "/notes", count: items.filter((i) => i.type === "note").length },
    { label: t(I18N.SNIPPETS), to: "/snippets", count: items.filter((i) => i.type === "snippet").length },
    { label: t(I18N.CREDENTIALS), to: "/credentials", count: items.filter((i) => i.type === "credential").length },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t(I18N.DASHBOARD_TITLE)}</h1>
      <InstallPrompt />
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
              <TagChip
                key={tag.name}
                name={tag.name}
                count={tag.count}
                active={activeTag === tag.name}
                onClick={() => setActiveTag(activeTag === tag.name ? null : tag.name)}
              />
            ))}
          </div>
        </div>
      )}

      {favorites.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">{t(I18N.FAVORITES)}</h2>
          <ItemGrid items={favorites} onOpen={(id) => navigate(`/items/${id}`)} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t(I18N.RECENT_ITEMS)}</h2>
        {recent.length === 0 ? (
          <EmptyState title={t(I18N.EMPTY_STATE)} description="Use Quick Add to create your first item." />
        ) : (
          <ItemGrid items={recent} onOpen={(id) => navigate(`/items/${id}`)} />
        )}
      </section>
    </div>
  );
}
