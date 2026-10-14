import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Links() {
  return <ItemsView title="Links" filter={(i: ItemWithId) => i.type === "link" && !i.is_archived} />;
}