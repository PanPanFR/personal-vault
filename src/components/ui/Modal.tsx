import React from "react";

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6" onClick={(e) => e.stopPropagation()}>
        {title && <h2 className="mb-4 text-xl font-semibold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}