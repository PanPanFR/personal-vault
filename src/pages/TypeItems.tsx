import React from "react";
import { ItemsView } from "../components/ItemsView";
import { t, I18N } from "../i18n";
import type { I18nKey } from "../i18n/keys";
import type { ItemType } from "../lib/types";

const TITLES: Record<ItemType, I18nKey> = {
  link: I18N.LINKS,
  note: I18N.NOTES,
  snippet: I18N.SNIPPETS,
  credential: I18N.CREDENTIALS,
};

/** One page for every "items of this type" route (links, notes, snippets, ...). */
export default function TypeItems({ type }: { type: ItemType }) {
  return <ItemsView title={t(TITLES[type])} type={type} />;
}
