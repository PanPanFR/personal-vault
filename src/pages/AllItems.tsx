import React from "react";
import { ItemsView } from "../components/ItemsView";
import { t, I18N } from "../i18n";

export default function AllItems() {
  return <ItemsView title={t(I18N.ALL_ITEMS)} />;
}
