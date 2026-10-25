import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  { op: '"phrase"', color: "var(--ctp-surface0)", fg: "var(--color-text)" },
  { op: "AND", color: "var(--ctp-surface0)", fg: "var(--color-text)" },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const optionId = (index: number) => `pv-search-option-${index}`;

export function SearchOverlay({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const navigate = useNavigate();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  // Move focus in on open, and back to the trigger on close.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(focusTimer);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  const results = useMemo(() => (query.trim() ? runSearch(items, query) : []), [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const select = (id: string) => {
    close();
    navigate(`/items/${id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActive((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      const result = results[active];
      if (result) {
        event.preventDefault();
        select(result.id);
      }
      return;
    }
    if (event.key !== "Tab") return;

    // Focus trap: Tab cycles inside the dialog only.
    const node = dialogRef.current;
    if (!node) return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(I18N.SEARCH_PLACEHOLDER)}
        className="mx-auto mt-20 max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(I18N.SEARCH_PLACEHOLDER)}
          aria-label={t(I18N.SEARCH_PLACEHOLDER)}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="pv-search-results"
          aria-expanded={results.length > 0}
          aria-activedescendant={results[active] ? optionId(active) : undefined}
        />
        <div
          id="pv-search-results"
          className="mt-3 max-h-80 overflow-auto"
          role="listbox"
          aria-label={t(I18N.SEARCH_PLACEHOLDER)}
        >
          {results.length === 0 && query.trim() && (
            <p className="text-sm text-[var(--color-muted)]">{t(I18N.NO_RESULTS)}</p>
          )}
          {results.map((result, index) => (
            <button
              key={result.id}
              id={optionId(index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--ctp-surface0)] aria-selected:bg-[var(--ctp-surface0)] focus-visible:bg-[var(--ctp-surface0)]"
              onMouseEnter={() => setActive(index)}
              onClick={() => select(result.id)}
            >
              <span className="font-medium">{result.title}</span>
              <span className="ml-2 text-xs text-[var(--color-muted)]">{result.type}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={close}>
            {t(I18N.CLOSE)} (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}
