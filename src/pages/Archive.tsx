import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Archive() {
  return <ItemsView title="Archive" filter={(i: ItemWithId) => i.is_archived} showQuickAdd={false} />;
}
