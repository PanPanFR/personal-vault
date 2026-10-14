import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={twMerge(
          clsx(
            "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50",
            size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
            variant === "primary" && "bg-[var(--color-primary)] text-white hover:opacity-90",
            variant === "secondary" && "bg-[var(--ctp-surface0)] text-[var(--color-text)] hover:bg-[var(--ctp-surface1)]",
            variant === "ghost" && "bg-transparent text-[var(--color-text)] hover:bg-[var(--ctp-surface0)]",
            variant === "danger" && "bg-[var(--color-error)] text-white hover:opacity-90",
          ),
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
