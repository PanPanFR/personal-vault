import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Favorites() {
  return <ItemsView title="Favorites" filter={(i: ItemWithId) => i.is_favorite && !i.is_archived} showQuickAdd={false} />;
}
