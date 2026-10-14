import React from "react";
import { ItemsView } from "../components/ItemsView";
export default function AllItems() {
  return <ItemsView title="All Items" filter={(i) => !i.is_archived} />;
}