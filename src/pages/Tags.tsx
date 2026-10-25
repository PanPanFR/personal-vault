import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { ItemGrid } from "../components/ItemGrid";
import { TagChip } from "../components/TagChip";
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

  const filtered = useMemo(
    () =>
      selected
        ? items.filter((item) => item.tags.includes(selected) && !item.is_archived)
        : [],
    [items, selected],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t(I18N.TAGS)}</h1>
      {tags.length === 0 ? (
        <EmptyState title={t(I18N.EMPTY_STATE)} description="Tags appear here once you add them to items." />
      ) : (
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <TagChip
                key={tag.name}
                name={tag.name}
                count={tag.count}
                active={selected === tag.name}
                onClick={() => {
                  setActive(tag.name);
                  navigate(`/tags/${encodeURIComponent(tag.name)}`);
                }}
              />
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
            <ItemGrid items={filtered} onOpen={(id) => navigate(`/items/${id}`)} />
          )}
        </section>
      )}
    </div>
  );
}
