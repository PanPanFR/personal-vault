import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Snippets() {
  return <ItemsView title="Snippets" filter={(i: ItemWithId) => i.type === "snippet" && !i.is_archived} />;
}
