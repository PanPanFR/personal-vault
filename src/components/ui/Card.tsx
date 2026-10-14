import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={twMerge(clsx("rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[var(--color-text)]"), className)}>
      {children}
    </div>
  );
}
export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={twMerge(clsx("mb-4", className))}>{children}</div>;
}
export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={twMerge(clsx("text-lg font-semibold", className))}>{children}</h3>;
}