import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/EmptyState";
import { ItemForm } from "../components/ItemForm";
import { I18N, t } from "../i18n";

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { items, update, remove, favorite, archive, restore, duplicate } =
    useItems();
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
            >
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
              onClick={() =>
                item.is_archived ? restore(item.id) : archive(item.id)
              }
            >
              {item.is_archived ? t(I18N.RESTORE) : t(I18N.ARCHIVE_ACTION)}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => duplicate(item.id)}
            >
              {t(I18N.DUPLICATE)}
            </Button>
            {confirmingDelete ? (
              <>
                <Button variant="danger" size="sm" onClick={handleDelete}>
                  {t(I18N.CONFIRM_DELETE)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t(I18N.CANCEL)}
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
              >
                {t(I18N.DELETE)}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {item.type === "link" && (
            <>
              <div>
                <strong>{t(I18N.URL)}:</strong>{" "}
                <a
                  className="text-[var(--color-link)]"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.url}
                </a>
              </div>
              {item.description && (
                <div>
                  <strong>{t(I18N.DESCRIPTION)}:</strong> {item.description}
                </div>
              )}
              {item.notes && (
                <div>
                  <strong>{t(I18N.NOTES_FIELD)}:</strong> {item.notes}
                </div>
              )}
            </>
          )}
          {item.type === "note" && (
            <p className="whitespace-pre-wrap">{item.body}</p>
          )}
          {item.type === "snippet" && (
            <>
              {item.language && (
                <p className="text-sm text-[var(--color-muted)]">
                  {item.language}
                </p>
              )}
              <pre className="overflow-auto rounded bg-[var(--ctp-crust)] p-3 font-mono text-sm">
                {item.content}
              </pre>
            </>
          )}
          {item.type === "credential" && (
            <>
              {item.website && (
                <div>
                  <strong>{t(I18N.WEBSITE)}:</strong> {item.website}
                </div>
              )}
              {item.username && (
                <div>
                  <strong>{t(I18N.USERNAME)}:</strong> {item.username}
                </div>
              )}
              {item.password !== undefined && (
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{t(I18N.PASSWORD)}:</strong>
                  <span>{revealed ? item.password : t(I18N.MASKED)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRevealed((v) => !v)}
                    aria-pressed={revealed}
                  >
                    {revealed ? t(I18N.HIDE) : t(I18N.REVEAL)}
                  </Button>
                  {/* Placeholder copy: full Clipboard + retention warning in crypto plan */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      navigator.clipboard?.writeText(item.password ?? "")
                    }
                  >
                    {t(I18N.COPY)}
                  </Button>
                </div>
              )}
              {item.notes && (
                <div>
                  <strong>{t(I18N.NOTES_FIELD)}:</strong> {item.notes}
                </div>
              )}
            </>
          )}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--ctp-surface0)] px-2 py-1 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
