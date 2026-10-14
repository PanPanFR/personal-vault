import React from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--ctp-crust)] p-10 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-2 text-sm text-[var(--color-muted)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}