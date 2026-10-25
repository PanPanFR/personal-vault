import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/EmptyState";
import { ItemBody } from "../components/ItemBody";
import { ItemForm } from "../components/ItemForm";
import { I18N, t } from "../i18n";

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { items, update, remove, favorite, archive, restore, duplicate } = useItems();
  const item = items.find((i) => i.id === id);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!item) {
    return (
      <EmptyState
        title={t(I18N.NOT_FOUND_TITLE)}
        description={t(I18N.NOT_FOUND_DESC)}
        action={<Button onClick={() => navigate("/")}>{t(I18N.BACK)}</Button>}
      />
    );
  }

  const handleDelete = async () => {
    await remove(item.id);
    navigate(-1);
  };

  if (editing) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-semibold">{t(I18N.EDIT)}</h2>
        <ItemForm
          initial={item}
          suggestions={item.tags}
          onSubmit={async (updated) => {
            await update(item.id, updated);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{item.title}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {item.type} · {item.created_at}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t(I18N.EDIT)}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => favorite(item.id)}
              aria-pressed={item.is_favorite}
              aria-label={t(I18N.FAVORITE)}
            >
              {item.is_favorite ? "★" : "☆"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (item.is_archived ? restore(item.id) : archive(item.id))}
            >
              {item.is_archived ? t(I18N.RESTORE) : t(I18N.ARCHIVE_ACTION)}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => duplicate(item.id)}>
              {t(I18N.DUPLICATE)}
            </Button>
            {confirmingDelete ? (
              <>
                <Button variant="danger" size="sm" onClick={handleDelete}>
                  {t(I18N.CONFIRM_DELETE)}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  {t(I18N.CANCEL)}
                </Button>
              </>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
                {t(I18N.DELETE)}
              </Button>
            )}
          </div>
        </div>
        <ItemBody
          item={item}
          revealed={revealed}
          onToggleReveal={() => setRevealed((v) => !v)}
        />
      </Card>
    </div>
  );
}
