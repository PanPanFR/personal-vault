import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={twMerge(
        clsx(
          "h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--ctp-base)] px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ctp-lavender)]",
        ),
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={twMerge(
        clsx(
          "w-full rounded-md border border-[var(--color-border)] bg-[var(--ctp-base)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ctp-lavender)]",
        ),
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={twMerge(
        clsx("h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--ctp-base)] px-3 text-sm text-[var(--color-text)]"),
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";