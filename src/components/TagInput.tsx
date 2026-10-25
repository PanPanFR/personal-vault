import { useState } from "react";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { validateTag } from "../lib/validators";
import { I18N, t } from "../i18n";

export function TagInput({ tags, onChange, suggestions = [], inputId = "tag-input" }: { tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; inputId?: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const err = validateTag(trimmed);
    if (err) { setError(err); return; }
    if (tags.includes(trimmed)) { setError("Duplicate tag"); return; }
    onChange([...tags, trimmed]);
    setValue("");
    setError(null);
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--ctp-surface0)] px-3 py-1 text-xs">
            {tag}
            <button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(value); } }}
          placeholder={t(I18N.TAG_INPUT_PLACEHOLDER)}
          list="tag-suggestions"
        />
        <datalist id="tag-suggestions">
          {suggestions.filter((s) => !tags.includes(s)).map((s) => <option key={s} value={s} />)}
        </datalist>
        <Button type="button" variant="secondary" size="sm" onClick={() => add(value)}>{t(I18N.ADD)}</Button>
      </div>
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  );
}