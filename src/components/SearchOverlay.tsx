import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { I18N, t } from "../i18n";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { runSearch } from "../lib/search";
import type { ItemWithId } from "../lib/types";

interface Props {
  items: ItemWithId[];
}

const OPERATOR_CHIPS = [
  { op: "type:", color: "var(--ctp-blue)", fg: "#fff" },
  { op: "tag:", color: "var(--ctp-green)", fg: "#fff" },
  { op: "is:", color: "var(--ctp-mauve)", fg: "#fff" },
  { op: "created:", color: "var(--ctp-sky)", fg: "#fff" },
  { op: "updated:", color: "var(--ctp-yellow)", fg: "#4c4f69" },
  { op: '"phrase"', color: "var(--ctp-surface0)", fg: "var(--color-text)" },
  { op: "AND", color: "var(--ctp-surface0)", fg: "var(--color-text)" },
];

export function SearchOverlay({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open ]);

  if (!open) return null;

  const results = query.trim() ? runSearch(items, query) : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(I18N.SEARCH_PLACEHOLDER)}
        className="mx-auto mt-20 max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex flex-wrap gap-1" aria-hidden="true">
          {OPERATOR_CHIPS.map((chip) => (
            <span
              key={chip.op}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: chip.color, color: chip.fg }}
            >
              {chip.op}
            </span>
          ))}
        </div>
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(I18N.SEARCH_PLACEHOLDER)}
          aria-label={t(I18N.SEARCH_PLACEHOLDER)}
          role="combobox"
          aria-expanded={results.length > 0}
        />
        <div className="mt-3 max-h-80 overflow-auto" role="listbox">
          {results.length === 0 && query.trim() && (
            <p className="text-sm text-[var(--color-muted)]">{t(I18N.NO_RESULTS)}</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected="false"
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--ctp-surface0)] focus-visible:bg-[var(--ctp-surface0)]"
              onClick={() => {
                setOpen(false);
                setQuery("");
                navigate(`/items/${r.id}`);
              }}
            >
              <span className="font-medium">{r.title}</span>
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                {r.type}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t(I18N.CLOSE)} (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}
