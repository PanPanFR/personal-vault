import React from "react";

interface Props {
  name: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

/** Tag pill used by the dashboard filters, the tag page and the item views. */
export function TagChip({ name, count, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs ${
        active ? "bg-[var(--color-primary)] text-white" : "bg-[var(--ctp-surface0)]"
      }`}
    >
      {name}
      {count !== undefined && ` (${count})`}
    </button>
  );
}
