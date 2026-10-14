import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Notes() {
  return <ItemsView title="Notes" filter={(i: ItemWithId) => i.type === "note" && !i.is_archived} />;
}
