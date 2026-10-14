import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function Badge({ className, children, color }: { className?: string; children: React.ReactNode; color?: string }) {
  return (
    <span
      className={twMerge(
        clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--ctp-surface0)] text-[var(--color-text)]", className),
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {children}
    </span>
  );
}