import React, { useState } from "react";
import { I18N, t } from "../i18n";
import { Input, Textarea, Select } from "./ui/Input";
import { Button } from "./ui/Button";
import { TagInput } from "./TagInput";
import type {
  CredentialItem,
  Item,
  ItemType,
  LinkItem,
  NoteItem,
  SnippetItem,
} from "../lib/types";
import { validateUrl } from "../lib/validators";

interface Props {
  initial?: Partial<Item>;
  type?: ItemType;
  suggestions?: string[];
  onSubmit: (item: Item) => Promise<void> | void;
  onCancel: () => void;
}

function now() {
  return new Date().toISOString();
}

export function ItemForm({ initial, type, suggestions, onSubmit, onCancel }: Props) {
  const resolvedType = (initial?.type ?? type ?? "note") as ItemType;
  const [itemType, setItemType] = useState<ItemType>(resolvedType);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState((initial as Partial<LinkItem>)?.url ?? "");
  const [description, setDescription] = useState(
    (initial as Partial<LinkItem>)?.description ?? "",
  );
  const [notes, setNotes] = useState(
    (initial as Partial<LinkItem> & Partial<CredentialItem>)?.notes ?? "",
  );
  const [body, setBody] = useState((initial as Partial<NoteItem>)?.body ?? "");
  const [content, setContent] = useState(
    (initial as Partial<SnippetItem>)?.content ?? "",
  );
  const [language, setLanguage] = useState(
    (initial as Partial<SnippetItem>)?.language ?? "text",
  );
  const [website, setWebsite] = useState(
    (initial as Partial<CredentialItem>)?.website ?? "",
  );
  const [username, setUsername] = useState(
    (initial as Partial<CredentialItem>)?.username ?? "",
  );
  const [password, setPassword] = useState(
    (initial as Partial<CredentialItem>)?.password ?? "",
  );
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    if (itemType === "link" && !validateUrl(url)) {
      setError("Invalid URL");
      return;
    }
    const created = initial?.created_at ?? now();
    const updated = now();
    const base = {
      title,
      tags,
      is_favorite: initial?.is_favorite ?? false,
      is_archived: initial?.is_archived ?? false,
      created_at: created,
      updated_at: updated,
      schema_version: 1 as const,
    };
    let item: Item;
    switch (itemType) {
      case "link":
        item = { ...base, type: "link", url, description, notes };
        break;
      case "note":
        item = { ...base, type: "note", body };
        break;
      case "snippet":
        item = { ...base, type: "snippet", content, language };
        break;
      case "credential":
        item = { ...base, type: "credential", website, username, password, notes };
        break;
    }
    try {
      await onSubmit(item);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial?.type && !type && (
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="item-type">
            Type
          </label>
          <Select
            id="item-type"
            value={itemType}
            onChange={(e) => setItemType(e.target.value as ItemType)}
          >
            <option value="link">Link</option>
            <option value="note">Note</option>
            <option value="snippet">Snippet</option>
            <option value="credential">Credential</option>
          </Select>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="item-title">
          {t(I18N.TITLE)}
        </label>
        <Input
          id="item-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      {itemType === "link" && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-url">
              {t(I18N.URL)}
            </label>
            <Input
              id="item-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-description">
              {t(I18N.DESCRIPTION)}
            </label>
            <Input
              id="item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-notes">
              {t(I18N.NOTES_FIELD)}
            </label>
            <Textarea id="item-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </>
      )}

      {itemType === "note" && (
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="item-body">
            {t(I18N.BODY)}
          </label>
          <Textarea
            id="item-body"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      )}

      {itemType === "snippet" && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-content">
              {t(I18N.CONTENT)}
            </label>
            <Textarea
              id="item-content"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-language">
              {t(I18N.LANGUAGE)}
            </label>
            <Input
              id="item-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </div>
        </>
      )}

      {itemType === "credential" && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-website">
              {t(I18N.WEBSITE)}
            </label>
            <Input
              id="item-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-username">
              {t(I18N.USERNAME)}
            </label>
            <Input
              id="item-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-password">
              {t(I18N.PASSWORD)}
            </label>
            <Input
              id="item-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="item-cred-notes">
              {t(I18N.NOTES_FIELD)}
            </label>
            <Textarea id="item-cred-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="item-tags">Tags</label>
        <TagInput tags={tags} onChange={setTags} suggestions={suggestions} inputId="item-tags" />
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit">
          {initial ? t(I18N.SAVE) : t(I18N.CREATE)}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t(I18N.CANCEL)}
        </Button>
      </div>
    </form>
  );
}
