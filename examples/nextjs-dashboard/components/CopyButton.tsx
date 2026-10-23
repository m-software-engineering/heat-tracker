"use client";

import { useEffect, useState } from "react";

/** How long "Copied" shows before the button reads "Copy" again (#29). */
export const COPIED_MS = 2_000;

type Props = { text: () => string; label: string; done: string; className?: string };

export default function CopyButton({ text, label, done, className }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text()).then(() => setCopied(true));
      }}
    >
      {copied ? done : label}
    </button>
  );
}
