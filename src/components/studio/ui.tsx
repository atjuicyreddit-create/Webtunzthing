"use client";

import { useFormStatus } from "react-dom";

// Submit button with a pending state, so a slow save can't be double-clicked.
export function SubmitButton({
  children,
  pendingText = "Working…",
  variant = "primary",
  formAction,
  className = "",
  disabled,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "quiet" | "info";
  formAction?: (form: FormData) => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending || disabled}
      className={`s-btn s-btn-${variant} ${className}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
