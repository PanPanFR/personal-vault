import React from "react";
import { Button } from "./ui/Button";
import { t, I18N } from "../i18n";
import type { ItemWithId } from "../lib/types";

interface Props {
  item: ItemWithId;
  revealed: boolean;
  onToggleReveal: () => void;
}

/** The type-specific fields of an item plus its tags. */
export function ItemBody({ item, revealed, onToggleReveal }: Props) {
  return (
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

      {item.type === "note" && <p className="whitespace-pre-wrap">{item.body}</p>}

      {item.type === "snippet" && (
        <>
          {item.language && (
            <p className="text-sm text-[var(--color-muted)]">{item.language}</p>
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
                onClick={onToggleReveal}
                aria-pressed={revealed}
              >
                {revealed ? t(I18N.HIDE) : t(I18N.REVEAL)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard?.writeText(item.password ?? "")}
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
  );
}
