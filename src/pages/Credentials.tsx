import React from "react";
import { ItemsView } from "../components/ItemsView";
import type { ItemWithId } from "../lib/types";
export default function Credentials() {
  return <ItemsView title="Credentials" filter={(i: ItemWithId) => i.type === "credential" && !i.is_archived} />;
}
