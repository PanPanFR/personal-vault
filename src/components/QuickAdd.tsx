import React, { useState } from "react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { ItemForm } from "./ItemForm";
import { useItems } from "../hooks/useItems";
import { useTags } from "../hooks/useTags";
import { I18N, t } from "../i18n";
import type { ItemType } from "../lib/types";

export function QuickAdd() {
  const { create } = useItems();
  const { tags: tagList } = useTags();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ItemType>("note");

  const suggestions = tagList.map((t) => t.name);

  const openFor = (ty: ItemType) => {
    setType(ty);
    setOpen(true);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t(I18N.QUICK_ADD)}</h3>
      <div className="flex flex-wrap gap-2">
        {(["link", "note", "snippet", "credential"] as ItemType[]).map((ty) => (
          <Button key={ty} variant="secondary" size="sm" onClick={() => openFor(ty)}>
            + {ty}
          </Button>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`${t(I18N.QUICK_ADD)} ${type}`}>
        <ItemForm
          type={type}
          onSubmit={async (item) => {
            await create(item);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
          suggestions={suggestions}
        />
      </Modal>
    </div>
  );
}