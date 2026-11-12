"use client";

import React from "react";

interface TruncatedTextProps {
  text: string;
  /** Tooltip text shown when `text` is cut off (defaults to `text`). */
  fullText?: string;
  /** Line clamping, e.g. "line-clamp-1" or "line-clamp-2 sm:line-clamp-1". */
  clampClassName?: string;
  className?: string;
}

/**
 * Text that is clamped to a number of lines (ending in "…") and shows a native tooltip
 * with `fullText` only when it is actually cut off.
 */
export function TruncatedText({
  text,
  fullText,
  clampClassName = "line-clamp-1",
  className,
}: TruncatedTextProps) {
  const updateTitle = (e: React.SyntheticEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    const cutOff = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    if (cutOff) el.title = fullText ?? text;
    else el.removeAttribute("title");
  };

  return (
    <span
      data-truncated-text
      className={`min-w-0 break-words ${clampClassName} ${className ?? ""}`}
      onMouseEnter={updateTitle}
      onFocus={updateTitle}
    >
      {text}
    </span>
  );
}
